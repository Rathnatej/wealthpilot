"""Live check of the Gemini Live setup (needs GEMINI_API_KEY and network).

Run from backend/:   ./venv/bin/python scripts/voice_smoke.py

Mints a real ephemeral token, connects with the same config the browser uses (voice, tools,
transcription, resumption, VAD), triggers the greeting and prints what came back.
Costs a few cents at most. Exit code 0 = audio was received.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
if not os.getenv("GEMINI_API_KEY"):
    sys.exit("GEMINI_API_KEY is not set")

import entitlements  # noqa: E402
import voice  # noqa: E402
from google import genai  # noqa: E402
from voice_prompt import TOOL_DECLARATIONS, build_system_prompt  # noqa: E402

MODEL = entitlements.settings()["model"]
VOICE = entitlements.settings()["default_voice"]


async def main() -> int:
    token = voice._mint_token(MODEL, 300)
    print("token minted:", token[:18] + "...")
    client = genai.Client(api_key=token)
    cfg = {
        "response_modalities": ["AUDIO"],
        "system_instruction": build_system_prompt("Ravi", []),
        "tools": [{"function_declarations": TOOL_DECLARATIONS}],
        "speech_config": {"voice_config": {"prebuilt_voice_config": {"voice_name": VOICE}}},
        "input_audio_transcription": {}, "output_audio_transcription": {},
        "session_resumption": {}, "context_window_compression": {"sliding_window": {}},
        "realtime_input_config": {"automatic_activity_detection": {
            "end_of_speech_sensitivity": "END_SENSITIVITY_LOW", "prefix_padding_ms": 200,
            "silence_duration_ms": 900}},
    }
    audio, said = 0, ""
    async with client.aio.live.connect(model=MODEL, config=cfg) as s:
        print("connected to", MODEL, "voice", VOICE)
        await s.send_realtime_input(text="(System note, never mention it: the person just opened the "
                                         "voice chat. Greet them as instructed.)")
        async for m in s.receive():
            sc = m.server_content
            if sc:
                for p in (sc.model_turn.parts if sc.model_turn else []):
                    if p.inline_data:
                        audio += len(p.inline_data.data)
                if sc.output_transcription and sc.output_transcription.text:
                    said += sc.output_transcription.text
                if sc.turn_complete:
                    break
    print(f"audio bytes received: {audio}\nassistant said: {said.strip()[:300]}")
    return 0 if audio > 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
