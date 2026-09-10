#!/usr/bin/env python3
"""Persistent, typed semantic memory for Mineradio's 小M assistant."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np


MODEL_ID = os.environ.get("MINERADIO_MEMORY_MODEL", "BAAI/bge-small-zh-v1.5")
DEFAULT_DB = Path(os.environ.get("MINERADIO_MEMORY_DB", Path(os.environ.get("APPDATA", Path.home())) / "Mineradio" / "agent-memory.sqlite3"))
MEMORY_TYPES = {"short_term", "context", "episodic", "preference", "habit", "profile", "summary"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_print(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


def normalize(value: Any, limit: int = 8000) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split())[:limit]


def content_tokens(text: str) -> list[str]:
    text = normalize(text).lower()
    words = re.findall(r"[a-z0-9]{2,}|[\u3400-\u9fff]", text)
    cjk = "".join(re.findall(r"[\u3400-\u9fff]", text))
    words.extend(cjk[index:index + 2] for index in range(max(0, len(cjk) - 1)))
    return words


class Embedder:
    def __init__(self) -> None:
        self.model = None
        self.tokenizer = None
        self.torch = None
        self.failed = False
        self.name = "hash-ngram-v1"

    def load(self) -> bool:
        if self.model is not None:
            return True
        if self.failed:
            return False
        try:
            import torch
            from transformers import AutoModel, AutoTokenizer
            self.torch = torch
            self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
            self.model = AutoModel.from_pretrained(MODEL_ID).eval()
            self.name = MODEL_ID
            return True
        except Exception as exc:
            print(f"[MemoryEmbedder] {exc}", file=sys.stderr, flush=True)
            self.failed = True
            return False

    def hashing(self, text: str) -> np.ndarray:
        vector = np.zeros(512, dtype=np.float32)
        for token in content_tokens(text):
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
            index = int.from_bytes(digest[:4], "little") % vector.size
            sign = 1.0 if digest[4] & 1 else -1.0
            vector[index] += sign
        norm = float(np.linalg.norm(vector))
        return vector / max(norm, 1e-12)

    def embed(self, text: str) -> tuple[np.ndarray, str]:
        if not self.load():
            return self.hashing(text), "hash-ngram-v1"
        assert self.torch is not None and self.tokenizer is not None and self.model is not None
        inputs = self.tokenizer([normalize(text, 4000)], padding=True, truncation=True, max_length=256, return_tensors="pt")
        with self.torch.inference_mode():
            output = self.model(**inputs).last_hidden_state
            mask = inputs["attention_mask"].unsqueeze(-1).to(output.dtype)
            vector = (output * mask).sum(1) / mask.sum(1).clamp_min(1e-9)
            vector = vector / vector.norm(dim=-1, keepdim=True).clamp_min(1e-12)
        return vector[0].float().cpu().numpy(), self.name


def classify(text: str) -> dict[str, Any]:
    clean = normalize(text)
    lower = clean.lower()
    memory_type = "episodic"
    importance = 0.48
    ttl_days: int | None = 90
    if re.search(r"(?:我|本人).{0,8}(?:叫|是|来自|住在|职业|年龄)|我的(?:名字|生日|家乡|工作)", clean):
        memory_type, importance, ttl_days = "profile", 0.9, None
    elif re.search(r"(?:喜欢|偏爱|最爱|爱听|讨厌|不喜欢|不要|偏好|口味)", clean):
        memory_type, importance, ttl_days = "preference", 0.86, None
    elif re.search(r"(?:总是|通常|经常|每次|习惯|一般会|固定)", clean):
        memory_type, importance, ttl_days = "habit", 0.76, 365
    elif re.search(r"(?:现在|当前|今天|今晚|这次|此刻|正在|马上)", clean):
        memory_type, importance, ttl_days = "context", 0.58, 2
    elif len(clean) < 24 and re.search(r"(?:播放|打开|关闭|调到|设置|推荐)", clean):
        memory_type, importance, ttl_days = "short_term", 0.36, 1

    polarity = -1 if re.search(r"(?:不喜欢|讨厌|不要|避免|排除)", clean) else 1
    target_match = re.search(r"(?:最?喜欢|偏爱|爱听|讨厌|不喜欢|不要|偏好)(?:的|听)?\s*([^，。！？,.!]{1,36})", clean)
    target = normalize(target_match.group(1), 60) if target_match else ""
    target = re.split(r"(?:和|以及|但|不过|并且|而且|，|,)", target, maxsplit=1)[0]
    target = re.sub(r"(?:的歌|音乐|歌曲|歌手|风格)$", "", target).strip()
    if memory_type == "preference" and target:
        conflict_key = "preference:" + target.lower()
    elif memory_type == "profile":
        field_match = re.search(r"我的(名字|生日|家乡|工作|职业)", clean)
        conflict_key = "profile:" + (field_match.group(1) if field_match else hashlib.sha1(clean.encode()).hexdigest()[:12])
    else:
        conflict_key = ""
    explicit = bool(re.search(r"(?:记住|别忘|长期|以后|今后)", clean))
    if explicit:
        importance = min(1.0, importance + 0.12)
        ttl_days = None if memory_type not in {"short_term", "context"} else ttl_days
    expires_at = (datetime.now(timezone.utc) + timedelta(days=ttl_days)).isoformat() if ttl_days else None
    return {"type": memory_type, "importance": importance, "expires_at": expires_at, "conflict_key": conflict_key, "polarity": polarity, "target": target, "explicit": explicit}


class MemoryStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path))
        self.db.row_factory = sqlite3.Row
        self.embedder = Embedder()
        self.init_schema()

    def init_schema(self) -> None:
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_type TEXT NOT NULL,
          content TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          conflict_key TEXT NOT NULL DEFAULT '',
          polarity INTEGER NOT NULL DEFAULT 1,
          importance REAL NOT NULL DEFAULT 0.5,
          confidence REAL NOT NULL DEFAULT 0.8,
          embedding BLOB NOT NULL,
          embedding_dim INTEGER NOT NULL,
          embedding_model TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'smallM',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_accessed_at TEXT NOT NULL,
          expires_at TEXT,
          access_count INTEGER NOT NULL DEFAULT 0,
          summarized INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_memories_status_type ON memories(status, memory_type);
        CREATE INDEX IF NOT EXISTS idx_memories_conflict ON memories(conflict_key, status);
        CREATE INDEX IF NOT EXISTS idx_memories_expiry ON memories(expires_at);
        """)
        self.db.commit()

    @staticmethod
    def vector_blob(vector: np.ndarray) -> bytes:
        return np.asarray(vector, dtype=np.float32).tobytes()

    @staticmethod
    def blob_vector(blob: bytes, dim: int) -> np.ndarray:
        return np.frombuffer(blob, dtype=np.float32, count=dim)

    def maintain(self) -> dict[str, int]:
        now = now_iso()
        expired = self.db.execute("UPDATE memories SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < ?", (now,)).rowcount
        cutoff = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
        archived = self.db.execute("UPDATE memories SET status='archived' WHERE status='active' AND memory_type='episodic' AND importance < 0.3 AND updated_at < ?", (cutoff,)).rowcount
        self.db.commit()
        return {"expired": expired, "archived": archived}

    def remember(self, payload: dict[str, Any]) -> dict[str, Any]:
        content = normalize(payload.get("content") or payload.get("message") or payload.get("text"), 8000)
        if not content:
            return {"ok": False, "error": "MEMORY_CONTENT_REQUIRED"}
        info = classify(content)
        requested_type = normalize(payload.get("memory_type") or payload.get("memoryType") or payload.get("type"), 40)
        if requested_type in MEMORY_TYPES:
            info["type"] = requested_type
            requested_ttl = {"short_term": 1, "context": 2, "episodic": 90, "habit": 365}.get(requested_type)
            info["expires_at"] = (datetime.now(timezone.utc) + timedelta(days=requested_ttl)).isoformat() if requested_ttl else None
        if payload.get("importance") is not None:
            info["importance"] = max(0.0, min(1.0, float(payload["importance"])))
        vector, model_name = self.embedder.embed(content)
        stamp = now_iso()
        recent_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        duplicate = self.db.execute("SELECT * FROM memories WHERE status='active' AND content=? AND updated_at>=? ORDER BY updated_at DESC LIMIT 1", (content, recent_cutoff)).fetchone()
        if duplicate:
            self.db.execute("UPDATE memories SET importance=MAX(importance, ?), updated_at=?, last_accessed_at=?, access_count=access_count+1, summary=CASE WHEN ?<>'' THEN ? ELSE summary END WHERE id=?", (info["importance"], stamp, stamp, normalize(payload.get("summary"), 1000), normalize(payload.get("summary"), 1000), duplicate["id"]))
            self.db.commit()
            return {"ok": True, "id": duplicate["id"], "updated": True, "deduplicated": True, "memoryType": duplicate["memory_type"], "embeddingModel": duplicate["embedding_model"]}
        conflict_key = info["conflict_key"]
        if conflict_key:
            previous = self.db.execute("SELECT * FROM memories WHERE conflict_key=? AND status='active' ORDER BY updated_at DESC LIMIT 1", (conflict_key,)).fetchone()
            if previous:
                if int(previous["polarity"]) != int(info["polarity"]) or normalize(previous["content"]).lower() != content.lower():
                    self.db.execute("UPDATE memories SET status='superseded', updated_at=? WHERE id=?", (stamp, previous["id"]))
                else:
                    self.db.execute("UPDATE memories SET importance=MAX(importance, ?), confidence=MIN(1, confidence + .05), updated_at=?, last_accessed_at=?, access_count=access_count+1 WHERE id=?", (info["importance"], stamp, stamp, previous["id"]))
                    self.db.commit()
                    return {"ok": True, "id": previous["id"], "updated": True, "memoryType": previous["memory_type"], "conflictKey": conflict_key, "embeddingModel": previous["embedding_model"]}
        cursor = self.db.execute("""
          INSERT INTO memories(memory_type,content,summary,conflict_key,polarity,importance,confidence,embedding,embedding_dim,embedding_model,source,status,created_at,updated_at,last_accessed_at,expires_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (info["type"], content, normalize(payload.get("summary"), 1000), conflict_key, info["polarity"], info["importance"], float(payload.get("confidence") or .82), self.vector_blob(vector), vector.size, model_name, normalize(payload.get("source") or "smallM", 80), "active", stamp, stamp, stamp, info["expires_at"]))
        self.db.commit()
        self.auto_summarize()
        return {"ok": True, "id": cursor.lastrowid, "updated": False, "memoryType": info["type"], "importance": info["importance"], "expiresAt": info["expires_at"], "conflictKey": conflict_key, "embeddingModel": model_name}

    def auto_summarize(self) -> None:
        rows = self.db.execute("SELECT * FROM memories WHERE status='active' AND summarized=0 AND memory_type IN ('episodic','context','short_term') ORDER BY created_at ASC LIMIT 40").fetchall()
        if len(rows) < 20:
            return
        key_rows = self.db.execute("SELECT * FROM memories WHERE status='active' AND memory_type IN ('preference','profile','habit') ORDER BY importance DESC, updated_at DESC LIMIT 12").fetchall()
        fragments = [f"[{row['memory_type']}] {normalize(row['content'], 180)}" for row in key_rows]
        fragments.extend(f"[经历] {normalize(row['content'], 140)}" for row in rows[-8:])
        summary = "；".join(fragments)[:5000]
        if not summary:
            return
        vector, model_name = self.embedder.embed(summary)
        stamp = now_iso()
        cursor = self.db.execute("""
          INSERT INTO memories(memory_type,content,summary,importance,confidence,embedding,embedding_dim,embedding_model,source,status,created_at,updated_at,last_accessed_at)
          VALUES('summary',?,?,?,?,?,?,?,?,?,?,?,?)
        """, (summary, "小M 自动整理的旧对话摘要", .72, .78, self.vector_blob(vector), vector.size, model_name, "auto-summary", "active", stamp, stamp, stamp))
        ids = [row["id"] for row in rows]
        self.db.executemany("UPDATE memories SET summarized=1, summary=? WHERE id=?", [(f"已汇总至记忆 #{cursor.lastrowid}", item_id) for item_id in ids])
        self.db.commit()

    def search(self, payload: dict[str, Any]) -> dict[str, Any]:
        query = normalize(payload.get("query") or payload.get("message"), 4000)
        limit = max(1, min(30, int(payload.get("limit") or 8)))
        if not query:
            return {"ok": True, "memories": [], "count": 0}
        self.maintain()
        query_vector, model_name = self.embedder.embed(query)
        rows = self.db.execute("SELECT * FROM memories WHERE status='active' AND (expires_at IS NULL OR expires_at >= ?) ORDER BY importance DESC, updated_at DESC LIMIT 3000", (now_iso(),)).fetchall()
        scored = []
        for row in rows:
            if row["embedding_model"] != model_name or int(row["embedding_dim"]) != query_vector.size:
                continue
            vector = self.blob_vector(row["embedding"], int(row["embedding_dim"]))
            semantic = float(np.dot(query_vector, vector))
            age_days = max(0.0, (datetime.now(timezone.utc) - datetime.fromisoformat(row["updated_at"])).total_seconds() / 86400)
            recency = math.exp(-age_days / (180 if row["memory_type"] in {"profile", "preference", "habit"} else 45))
            type_bonus = {"preference": .10, "profile": .09, "habit": .07, "context": .05, "summary": .04}.get(row["memory_type"], 0)
            score = semantic * .72 + float(row["importance"]) * .18 + recency * .10 + type_bonus
            if score < .24:
                continue
            scored.append((score, semantic, row))
        scored.sort(key=lambda item: (-item[0], -float(item[2]["importance"]), item[2]["id"]))
        selected = scored[:limit]
        stamp = now_iso()
        self.db.executemany("UPDATE memories SET access_count=access_count+1,last_accessed_at=? WHERE id=?", [(stamp, row["id"]) for _, _, row in selected])
        self.db.commit()
        memories = [{"id": row["id"], "type": row["memory_type"], "content": row["content"], "summary": row["summary"], "importance": round(float(row["importance"]), 3), "score": round(score, 4), "semanticScore": round(semantic, 4), "updatedAt": row["updated_at"], "expiresAt": row["expires_at"]} for score, semantic, row in selected]
        return {"ok": True, "query": query, "count": len(memories), "embeddingModel": model_name, "memories": memories}

    def status(self) -> dict[str, Any]:
        self.maintain()
        counts = {row["memory_type"]: row["count"] for row in self.db.execute("SELECT memory_type,COUNT(*) count FROM memories WHERE status='active' GROUP BY memory_type")}
        total = sum(counts.values())
        return {"ok": True, "ready": True, "database": str(self.db_path), "activeCount": total, "types": counts, "embeddingModel": self.embedder.name, "semanticModelConfigured": MODEL_ID}

    def clear(self, payload: dict[str, Any]) -> dict[str, Any]:
        scope = normalize(payload.get("scope") or "short_term", 40)
        if scope == "all" and payload.get("confirmed") is True:
            changed = self.db.execute("UPDATE memories SET status='deleted' WHERE status='active'").rowcount
        elif scope == "conversation":
            changed = self.db.execute("UPDATE memories SET status='deleted' WHERE status='active' AND memory_type IN ('short_term','context','episodic')").rowcount
        else:
            changed = self.db.execute("UPDATE memories SET status='deleted' WHERE status='active' AND memory_type IN ('short_term','context')").rowcount
        self.db.commit()
        return {"ok": True, "cleared": changed, "scope": scope}


def handle(store: MemoryStore, request: dict[str, Any]) -> dict[str, Any]:
    action = normalize(request.get("action") or "status", 40)
    payload = request.get("payload") if isinstance(request.get("payload"), dict) else request
    if action == "remember":
        return store.remember(payload)
    if action == "search":
        return store.search(payload)
    if action == "maintain":
        return {"ok": True, **store.maintain()}
    if action == "clear":
        return store.clear(payload)
    if action == "status":
        return store.status()
    return {"ok": False, "error": "UNKNOWN_ACTION"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    store = MemoryStore(args.db)
    if args.once:
        request = json.loads(sys.stdin.read() or "{}")
        json_print(handle(store, request))
        return 0
    for line in sys.stdin:
        request_id = ""
        try:
            request = json.loads(line)
            request_id = str(request.get("id") or "")
            result = handle(store, request)
            if "id" in result:
                result["memoryId"] = result.pop("id")
            json_print({"id": request_id, **result})
        except Exception as exc:
            json_print({"id": request_id, "ok": False, "error": "MEMORY_FAILED", "message": str(exc)[:1000]})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())




