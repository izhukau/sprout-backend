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
    max_num_hands=2,
    model_complexity=0,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.8,
)

SEND_INTERVAL = 1 / 60      # cap at 60fps to prevent WebSocket queue buildup
SMOOTH_ALPHA = 0.35          # EMA weight for new sample (lower = smoother, more lag)
PALM_HOLD_SECONDS = 3.0      # hold open palm this long to enter grab mode


def _dist2(a, b):
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2


def is_open_palm(lm): # True when all 4 fingers (index, middle, ring, pinky) are extended.
    wrist = lm[0]
    for tip_idx, pip_idx in [(8, 6), (12, 10), (16, 14), (20, 18)]:
        tip = lm[tip_idx]
        pip = lm[pip_idx]
        tip_dist2 = _dist2(tip, wrist)
        pip_dist2 = _dist2(pip, wrist)
        # Extended = tip farther from wrist than PIP (relaxed 1.08), or tip above PIP (y down in image)
        extended_by_dist = tip_dist2 > pip_dist2 * 1.08
        extended_by_y = tip.y < pip.y
        if not (extended_by_dist or extended_by_y):
            return False
    return True


def palm_center(lm): # Stable palm anchor: average of wrist (0) and the 4 finger MCP joints (5,9,13,17)
    pts = [0, 5, 9, 13, 17]
    x = sum(lm[i].x for i in pts) / len(pts)
    y = sum(lm[i].y for i in pts) / len(pts)
    z = sum(lm[i].z for i in pts) / len(pts)
    return x, y, z


class HandState: # Per-hand smoothing state + open-palm grab timer

    def __init__(self):
        self.reset()

    def reset(self):
        # Cursor smoothing (index fingertip — used for normal pointer / pinch)
        self.sx = self.sy = self.sz = self.spinch = None
        # Palm-center smoothing (used when grabbing a node)
        self.spx = self.spy = self.spz = None
        # Palm hold timer
        self.palm_start_time = None
        self.is_grabbing = False

    def update(self, lm, open_palm, now):
        tip = lm[8]     # index finger tip
        thumb = lm[4]   # thumb tip
        px, py, pz = palm_center(lm)
        pinch = math.hypot(thumb.x - tip.x, thumb.y - tip.y)

        # EMA smoothing
        if self.sx is None:
            self.sx, self.sy, self.sz, self.spinch = tip.x, tip.y, tip.z, pinch
            self.spx, self.spy, self.spz = px, py, pz
        else:
            self.sx = SMOOTH_ALPHA * tip.x + (1 - SMOOTH_ALPHA) * self.sx
            self.sy = SMOOTH_ALPHA * tip.y + (1 - SMOOTH_ALPHA) * self.sy
            self.sz = SMOOTH_ALPHA * tip.z + (1 - SMOOTH_ALPHA) * self.sz
            self.spinch = SMOOTH_ALPHA * pinch + (1 - SMOOTH_ALPHA) * self.spinch
            self.spx = SMOOTH_ALPHA * px + (1 - SMOOTH_ALPHA) * self.spx
            self.spy = SMOOTH_ALPHA * py + (1 - SMOOTH_ALPHA) * self.spy
            self.spz = SMOOTH_ALPHA * pz + (1 - SMOOTH_ALPHA) * self.spz

        # Palm hold timer 3ss
        if open_palm:
            if self.palm_start_time is None:
                self.palm_start_time = now
            hold_duration = now - self.palm_start_time
            if hold_duration >= PALM_HOLD_SECONDS:
                self.is_grabbing = True
        else:
            self.palm_start_time = None
            self.is_grabbing = False

        hold_duration = (now - self.palm_start_time) if self.palm_start_time else 0.0

        return {
            # Index-tip cursor position + pinch (for normal pointer/zoom)
            "x": self.sx,
            "y": self.sy,
            "z": self.sz,
            "pinch": self.spinch,
            # Palm-center position (front-end uses this to drag the grabbed node)
            "palm_x": self.spx,
            "palm_y": self.spy,
            "palm_z": self.spz,
            # Grab state — front-end reads these to enter/exit node-drag mode
            "is_open_palm": open_palm,
            "palm_hold_duration": min(hold_duration, PALM_HOLD_SECONDS),
            "is_grabbing": self.is_grabbing,
        }


async def track_hands(websocket):
    print("Streaming hand data")
    last_send = 0.0
    cap = cv2.VideoCapture(0)

    # Per-connection state so multiple clients never share smoothing buffers
    hand_states = [HandState(), HandState()]

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = hands.process(rgb_frame)

            now = time.monotonic()
            hands_data = []

            if result.multi_hand_landmarks:
                for idx, (hand_lm, handedness) in enumerate(
                    zip(result.multi_hand_landmarks, result.multi_handedness)
                ):
                    lm = hand_lm.landmark
                    open_palm = is_open_palm(lm)
                    label = handedness.classification[0].label  # "Left" or "Right"

                    state = hand_states[min(idx, 1)]
                    data = state.update(lm, open_palm, now)
                    data["hand"] = idx
                    data["handedness"] = label
                    hands_data.append(data)

                # Reset state for any hand slot that lost tracking this frame
                detected = len(result.multi_hand_landmarks)
                for i in range(detected, 2):
                    hand_states[i].reset()
            else:
                # No hands in frame — reset all state
                for hs in hand_states:
                    hs.reset()

            # Rate-limit sends to 60 fps
            if now - last_send >= SEND_INTERVAL:
                await websocket.send(json.dumps({"hands": hands_data}))
                last_send = now

            await asyncio.sleep(0.005)
    finally:
        cap.release()
        print("Client disconnected")


async def main():
    async with websockets.serve(track_hands, "localhost", 8765):
        print("WebSocket Server started on ws://localhost:8765")
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    asyncio.run(main())
