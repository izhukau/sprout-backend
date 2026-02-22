import cv2
import mediapipe as mp
import asyncio
import websockets
import json
import time
import math

# Initialize MediaPipe at module level (matches the working legacy API pattern)
# model_complexity=0 is the lightest/fastest model — less latency, less jitter
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(
    max_num_hands=1,
    model_complexity=0,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.8,
)

SEND_INTERVAL = 1 / 60  # cap at 30fps to prevent WebSocket queue buildup
SMOOTH_ALPHA = 0.35      # EMA weight for new sample (lower = smoother, more lag)

async def track_hands(websocket):
    print("Streaming hand data")
    sx, sy, sz, spinch = None, None, None, None
    last_send = 0.0
    cap = cv2.VideoCapture(0)

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = hands.process(rgb_frame)

            if result.multi_hand_landmarks:
                lm = result.multi_hand_landmarks[0].landmark
                tip = lm[8]    # index finger tip
                thumb = lm[4]  # thumb tip

                # Pinch distance (normalized 0-1)
                pinch = math.hypot(thumb.x - tip.x, thumb.y - tip.y)

                # EMA smoothing
                if sx is None:
                    sx, sy, sz, spinch = tip.x, tip.y, tip.z, pinch
                else:
                    sx = SMOOTH_ALPHA * tip.x + (1 - SMOOTH_ALPHA) * sx
                    sy = SMOOTH_ALPHA * tip.y + (1 - SMOOTH_ALPHA) * sy
                    sz = SMOOTH_ALPHA * tip.z + (1 - SMOOTH_ALPHA) * sz
                    spinch = SMOOTH_ALPHA * pinch + (1 - SMOOTH_ALPHA) * spinch

                print(f"Pinch: {spinch:.3f}, X: {sx:.3f}, Y: {sy:.3f}, Z: {sz:.3f}", end="\r")

                # Rate-limit sends to 60fps
                now = time.monotonic()
                if now - last_send >= SEND_INTERVAL:
                    await websocket.send(json.dumps({"x": sx, "y": sy, "z": sz, "pinch": spinch}))
                    last_send = now
            else:
                # Hand lost - reset smoothing state
                sx, sy, sz, spinch = None, None, None, None

            await asyncio.sleep(0.005)
    finally:
        cap.release()

async def main():
    async with websockets.serve(track_hands, "localhost", 8765):
        print("WebSocket Server started on ws://localhost:8765")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
