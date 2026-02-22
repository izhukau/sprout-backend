import cv2
import mediapipe as mp
import asyncio
import websockets
import json

# Initialize MediaPipe at module level (matches the working legacy API pattern)
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(max_num_hands=1, min_detection_confidence=0.7, min_tracking_confidence=0.7)

async def track_hands(websocket):
    print("Next.js Frontend Connected!")
    cap = cv2.VideoCapture(0)

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break

            frame = cv2.flip(frame, 1)
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = hands.process(rgb_frame)

            if result.multi_hand_landmarks:
                for hand_landmarks in result.multi_hand_landmarks:
                    index_tip = hand_landmarks.landmark[8]
                    data = {"x": index_tip.x, "y": index_tip.y, "z": index_tip.z}
                    await websocket.send(json.dumps(data))

            await asyncio.sleep(0.01)
    finally:
        cap.release()

async def main():
    async with websockets.serve(track_hands, "localhost", 8765):
        print("WebSocket Server started on ws://localhost:8765")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
