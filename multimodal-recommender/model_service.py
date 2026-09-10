#!/usr/bin/env python3
"""Local CLIP + CLAP recommender service for Mineradio.

The process speaks newline-delimited JSON on stdin/stdout so Electron can keep the
models warm between recommendations.  Model files and embeddings stay on the
user's machine.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import traceback
import urllib.request
from pathlib import Path
from typing import Any


APP_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = Path(os.environ.get("MINERADIO_MULTIMODAL_CACHE", APP_DIR / "multimodal-recommender" / ".cache"))
CLIP_MODEL_ID = os.environ.get("MINERADIO_CLIP_MODEL", "openai/clip-vit-base-patch32")
CLAP_MODEL_ID = os.environ.get("MINERADIO_CLAP_MODEL", "laion/clap-htsat-unfused")
MAX_REMOTE_BYTES = 24 * 1024 * 1024


def _json_print(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


def _dependency_error() -> str:
    missing: list[str] = []
    for module in ("torch", "transformers", "PIL"):
        try:
            __import__(module)
        except Exception:
            missing.append(module)
    if missing:
        return "缺少完整模型依赖：" + ", ".join(missing) + "。请运行 multimodal-recommender/install-model.ps1。"
    return ""


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())[:1000]


def _bilingual_prompt(text: str) -> str:
    """Add stable English anchors for common Chinese music-language prompts."""
    anchors = {
        "放松": "relaxing calm music", "治愈": "healing soothing music",
        "开心": "happy uplifting music", "快乐": "happy upbeat music",
        "伤感": "sad emotional music", "失恋": "heartbreak emotional music",
        "通勤": "commuting background music", "学习": "focus study music",
        "工作": "focus work music", "运动": "energetic workout music",
        "跑步": "energetic running music", "睡眠": "soft sleep music",
        "摇滚": "rock music", "民谣": "folk acoustic music", "电子": "electronic music",
        "古典": "classical music", "爵士": "jazz music", "嘻哈": "hip hop music",
        "说唱": "rap hip hop music", "国风": "Chinese traditional style music",
        "纯音乐": "instrumental music", "女声": "female vocal music", "男声": "male vocal music",
    }
    extras = [value for key, value in anchors.items() if key in text]
    return text if not extras else text + ". " + "; ".join(dict.fromkeys(extras))


def _safe_source(source: Any) -> str:
    value = str(source or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        return value[:4096]
    try:
        resolved = Path(value).expanduser().resolve(strict=True)
    except Exception:
        return ""
    return str(resolved) if resolved.is_file() else ""


def _cache_key(source: str, kind: str) -> str:
    revision = source
    if source and not source.startswith(("http://", "https://")):
        try:
            stat = Path(source).stat()
            revision += f"|{stat.st_size}|{stat.st_mtime_ns}"
        except OSError:
            pass
    return hashlib.sha256(f"v2|{kind}|{revision}".encode("utf-8", "ignore")).hexdigest()


class ModelRuntime:
    def __init__(self, cache_dir: Path = DEFAULT_CACHE) -> None:
        import numpy as np
        import torch
        from transformers import AutoProcessor, ClapModel, CLIPModel

        self.np = np
        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if self.device == "cuda" else torch.float32
        self.clip = CLIPModel.from_pretrained(CLIP_MODEL_ID, torch_dtype=dtype, use_safetensors=False).to(self.device).eval()
        self.clip_processor = AutoProcessor.from_pretrained(CLIP_MODEL_ID)
        self.clap = ClapModel.from_pretrained(CLAP_MODEL_ID, torch_dtype=dtype, use_safetensors=False).to(self.device).eval()
        self.clap_processor = AutoProcessor.from_pretrained(CLAP_MODEL_ID)
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.memory_cache: dict[str, Any] = {}

    def _tensor(self, value: Any):
        if hasattr(value, "pooler_output"):
            value = value.pooler_output
        if isinstance(value, tuple):
            value = value[0]
        value = value.float()
        return value / value.norm(dim=-1, keepdim=True).clamp_min(1e-12)

    def _to_device(self, inputs: dict[str, Any]) -> dict[str, Any]:
        return {key: value.to(self.device) if hasattr(value, "to") else value for key, value in inputs.items()}

    def _load_cached(self, key: str):
        if key in self.memory_cache:
            return self.memory_cache[key]
        file = self.cache_dir / f"{key}.npy"
        try:
            value = self.np.load(file, allow_pickle=False).astype("float32")
            self.memory_cache[key] = value
            return value
        except Exception:
            return None

    def _save_cached(self, key: str, value) -> None:
        vector = self.np.asarray(value, dtype="float32")
        self.memory_cache[key] = vector
        target = self.cache_dir / f"{key}.npy"
        stage = target.with_suffix(f".{os.getpid()}.tmp.npy")
        try:
            self.np.save(stage, vector, allow_pickle=False)
            os.replace(stage, target)
        except Exception:
            try:
                stage.unlink(missing_ok=True)
            except OSError:
                pass

    def clip_text(self, text: str):
        inputs = self.clip_processor(text=[_bilingual_prompt(text)], padding=True, truncation=True, return_tensors="pt")
        inputs = self._to_device(inputs)
        with self.torch.inference_mode():
            return self._tensor(self.clip.get_text_features(**inputs))[0].cpu().numpy()

    def clap_text(self, text: str):
        inputs = self.clap_processor(text=[_bilingual_prompt(text)], padding=True, truncation=True, return_tensors="pt")
        inputs = self._to_device(inputs)
        with self.torch.inference_mode():
            return self._tensor(self.clap.get_text_features(**inputs))[0].cpu().numpy()

    def cover(self, source: str):
        from PIL import Image

        source = _safe_source(source)
        if not source:
            return None
        key = _cache_key(source, "clip-cover")
        cached = self._load_cached(key)
        if cached is not None:
            return cached
        try:
            if source.startswith(("http://", "https://")):
                request = urllib.request.Request(source, headers={"User-Agent": "Mineradio/1.6 multimodal-recommender"})
                with urllib.request.urlopen(request, timeout=12) as response:
                    data = response.read(MAX_REMOTE_BYTES + 1)
                if len(data) > MAX_REMOTE_BYTES:
                    return None
                image = Image.open(io.BytesIO(data)).convert("RGB")
            else:
                image = Image.open(source).convert("RGB")
            inputs = self.clip_processor(images=image, return_tensors="pt")
            inputs = self._to_device(inputs)
            with self.torch.inference_mode():
                vector = self._tensor(self.clip.get_image_features(**inputs))[0].cpu().numpy()
            self._save_cached(key, vector)
            return vector
        except Exception:
            return None

    def _ffmpeg(self) -> str:
        configured = os.environ.get("MINERADIO_FFMPEG", "")
        bundled = APP_DIR / "bin" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
        return configured or (str(bundled) if bundled.exists() else "ffmpeg")

    def _decode_audio(self, source: str):
        source = _safe_source(source)
        if not source:
            return None
        command = [self._ffmpeg(), "-v", "error", "-ss", "20", "-i", source, "-t", "10", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"]
        try:
            run = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=40, check=False, creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
            data = run.stdout
            if len(data) < 48000 * 4:
                command[4] = "0"
                run = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=40, check=False, creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
                data = run.stdout
            return self.np.frombuffer(data, dtype="float32").copy() if len(data) >= 48000 * 4 else None
        except Exception:
            return None

    def audio(self, source: str):
        source = _safe_source(source)
        if not source:
            return None
        key = _cache_key(source, "clap-audio-10s")
        cached = self._load_cached(key)
        if cached is not None:
            return cached
        waveform = self._decode_audio(source)
        if waveform is None:
            return None
        try:
            inputs = self.clap_processor(audios=[waveform], sampling_rate=48000, return_tensors="pt")
            inputs = self._to_device(inputs)
            with self.torch.inference_mode():
                vector = self._tensor(self.clap.get_audio_features(**inputs))[0].cpu().numpy()
            self._save_cached(key, vector)
            return vector
        except Exception:
            return None

    def recommend(self, payload: dict[str, Any]) -> dict[str, Any]:
        candidates = payload.get("candidates") if isinstance(payload.get("candidates"), list) else []
        candidates = [item for item in candidates[:200] if isinstance(item, dict)]
        preference = _normalize_text(payload.get("preference_text") or payload.get("preferenceText") or "符合我的音乐口味")
        limit = max(1, min(50, int(payload.get("limit") or 10)))
        clip_query = self.clip_text(preference)
        clap_query = self.clap_text(preference)

        rows: list[dict[str, Any]] = []
        signal_keys = {
            str(item.get("key") or ""): float(item.get("weight") or 1)
            for item in (payload.get("signals") or [])[:500] if isinstance(item, dict)
        }
        for index, item in enumerate(candidates):
            cover = self.cover(item.get("cover_path") or item.get("cover_url") or "")
            audio = self.audio(item.get("audio_path") or item.get("audio_url") or "")
            key = str(item.get("key") or item.get("id") or index)
            metadata = _normalize_text(" ".join(str(item.get(field) or "") for field in ("title", "artist", "album", "tags")))
            tokens = [token for token in preference.replace("，", " ").replace(",", " ").split() if len(token) > 1]
            lexical = sum(1 for token in tokens if token.lower() in metadata) / max(1, len(tokens))
            rows.append({
                "clientIndex": int(item.get("clientIndex", index)), "key": key,
                "title": str(item.get("title") or "")[:300], "artist": str(item.get("artist") or "")[:300],
                "coverVector": cover, "audioVector": audio, "lexical": lexical,
                "signal": max(0.0, signal_keys.get(key, float(item.get("preference_weight") or 0))),
            })

        positive_covers = [row["coverVector"] for row in rows if row["coverVector"] is not None and row["signal"] > 0]
        positive_audio = [row["audioVector"] for row in rows if row["audioVector"] is not None and row["signal"] > 0]
        cover_profile = self.np.mean(positive_covers, axis=0) if positive_covers else None
        audio_profile = self.np.mean(positive_audio, axis=0) if positive_audio else None
        if cover_profile is not None:
            cover_profile /= max(float(self.np.linalg.norm(cover_profile)), 1e-12)
        if audio_profile is not None:
            audio_profile /= max(float(self.np.linalg.norm(audio_profile)), 1e-12)

        ranked: list[dict[str, Any]] = []
        for row in rows:
            components: dict[str, float] = {}
            if row["coverVector"] is not None:
                components["cover"] = float(self.np.dot(row["coverVector"], clip_query))
                if cover_profile is not None:
                    components["behaviorCover"] = float(self.np.dot(row["coverVector"], cover_profile))
            if row["audioVector"] is not None:
                components["audio"] = float(self.np.dot(row["audioVector"], clap_query))
                if audio_profile is not None:
                    components["behaviorAudio"] = float(self.np.dot(row["audioVector"], audio_profile))
            components["metadata"] = float(row["lexical"])
            weights = {"cover": .28, "audio": .38, "behaviorCover": .12, "behaviorAudio": .17, "metadata": .05}
            available = sum(weights[name] for name in components)
            score = sum(components[name] * weights[name] for name in components) / max(available, 1e-12)
            # Do not simply recommend the already-liked seed itself, but retain a small confidence prior.
            score += min(.03, row["signal"] * .01)
            ranked.append({
                "clientIndex": row["clientIndex"], "key": row["key"], "title": row["title"],
                "artist": row["artist"], "score": round(score, 6),
                "components": {name: round(value, 6) for name, value in components.items()},
                "modalities": [name for name in ("cover", "audio") if name in components],
            })
        ranked.sort(key=lambda item: (-item["score"], item["clientIndex"]))
        return {
            "ok": True, "mode": "clip-clap-fusion", "device": self.device,
            "models": {"cover": CLIP_MODEL_ID, "audio": CLAP_MODEL_ID},
            "preferenceText": preference, "candidateCount": len(rows), "ranked": ranked[:limit],
        }


def _serve_once(runtime: ModelRuntime, request: dict[str, Any]) -> dict[str, Any]:
    action = request.get("action") or "recommend"
    if action == "status":
        return {"ok": True, "ready": True, "device": runtime.device, "models": {"cover": CLIP_MODEL_ID, "audio": CLAP_MODEL_ID}}
    if action != "recommend":
        return {"ok": False, "error": "UNKNOWN_ACTION", "message": f"Unknown action: {action}"}
    return runtime.recommend(request.get("payload") if isinstance(request.get("payload"), dict) else request)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    error = _dependency_error()
    if args.probe:
        _json_print({"ok": not error, "ready": not error, "error": "DEPENDENCIES_MISSING" if error else "", "message": error})
        return 0 if not error else 2
    if error:
        _json_print({"ok": False, "error": "DEPENDENCIES_MISSING", "message": error})
        return 2
    try:
        runtime = ModelRuntime()
    except Exception as exc:
        _json_print({"ok": False, "error": "MODEL_LOAD_FAILED", "message": str(exc)[:1000]})
        return 3
    if args.once:
        try:
            request = json.loads(sys.stdin.read() or "{}")
            _json_print(_serve_once(runtime, request))
            return 0
        except Exception as exc:
            _json_print({"ok": False, "error": "INFERENCE_FAILED", "message": str(exc)[:1000]})
            return 4
    for line in sys.stdin:
        request_id = ""
        try:
            request = json.loads(line)
            request_id = str(request.get("id") or "")
            result = _serve_once(runtime, request)
            _json_print({"id": request_id, **result})
        except Exception as exc:
            _json_print({"id": request_id, "ok": False, "error": "INFERENCE_FAILED", "message": str(exc)[:1000]})
            traceback.print_exc(file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())




