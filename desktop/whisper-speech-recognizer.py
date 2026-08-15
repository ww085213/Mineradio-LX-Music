import argparse
import json
import os
import sys

from faster_whisper import WhisperModel


def emit(value):
    # Keep the child-process protocol ASCII-only. Windows may otherwise encode
    # redirected stdout with the active ANSI code page while Node decodes UTF-8.
    sys.stdout.write(json.dumps(value, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()

    if not os.path.isfile(args.audio) or os.path.getsize(args.audio) < 1024:
        emit({"ok": False, "error": "SPEECH_NOT_HEARD"})
        return 3
    if not os.path.isdir(args.model):
        emit({"ok": False, "error": "WHISPER_MODEL_NOT_FOUND"})
        return 4

    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        prompt = (
            "这是中文音乐播放器语音指令，可能包含歌手、歌名、播放、暂停、下一首、上一首、"
            "音量、歌单、队列、周杰伦、林俊杰、陈奕迅、王菲、邓紫棋、Taylor Swift、Coldplay。"
        )
        segments, info = model.transcribe(
            args.audio,
            language="zh",
            task="transcribe",
            beam_size=5,
            best_of=5,
            patience=1.2,
            temperature=0.0,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 450, "speech_pad_ms": 250},
            initial_prompt=prompt,
            condition_on_previous_text=False,
        )
        text = "".join(segment.text for segment in segments).strip()
        if not text:
            emit({"ok": False, "error": "SPEECH_NOT_HEARD"})
            return 3
        emit({
            "ok": True,
            "text": text,
            "language": getattr(info, "language", "zh"),
            "engine": "faster-whisper-small-zh",
        })
        return 0
    except Exception:
        emit({"ok": False, "error": "WHISPER_RECOGNITION_FAILED"})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
