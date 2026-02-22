# Hand Tracking — Setup & Run Guide

## Exact Dependency Versions

| Package | Version |
|---|---|
| `mediapipe` | `0.10.14` |
| `opencv-python` | `4.13.0.92` |
| `websockets` | `12.0` |
| `numpy` | `2.4.2` (auto-installed by mediapipe) |

---

## 1. Create an Isolated Conda Environment

```bash
conda create -n aircanvas python=3.10 -y
conda activate aircanvas
```

> Use Python 3.10.

---

## 2. Install Dependencies

Install each package with `--no-cache-dir` and `--default-timeout=100` to avoid stale/corrupt caches and network timeout issues.

```bash
pip install mediapipe==0.10.14 --no-cache-dir --default-timeout=100
pip install opencv-python==4.13.0.92 --no-cache-dir --default-timeout=100
pip install websockets==12.0 --no-cache-dir --default-timeout=100
```

Or install from `requirements.txt` (same flags still apply):

```bash
pip install -r requirements.txt --no-cache-dir --default-timeout=100
```

---

## 3. Run the WebSocket Server

```bash
conda activate aircanvas
python backend.py
```

Expected output:
```
WebSocket Server started on ws://localhost:8765
```

---

## Key Notes

- **Port**: `8765` — avoids conflict with the Node.js backend on `8000`
- **MediaPipe init must be at module level** — `mp.solutions.hands` fails if accessed inside an async handler. It is initialized at the top of `backend.py`, outside any function.
- **Webcam**: `cv2.VideoCapture(0)` — uses the default webcam (index 0). Change to `1` if you have multiple cameras.
- The frontend connects to this server from the hand tracking toggle button (bottom-right of the graph view).

---

## Protocol (per frame, capped at 60 fps)

```json
{ "hands": [ { "handedness": "Left"|"Right", "x","y","z","pinch", "palm_x","palm_y","palm_z", "is_open_palm","palm_hold_duration","is_grabbing" } ] }
```

Both hands are sent when detected. The frontend uses all of them — no single "primary" hand is locked.

---

## Gesture Logic

| Gesture | Effect |
|---|---|
| Hand present, not open palm | Camera orbits (index-tip drives azimuth/elevation) |
| Open palm held 3 s | Enters grab mode (`is_grabbing = true`) |
| Grabbing + palm over a node | Drags that node (and its subconcepts if it's a concept node) |
| Palm closed / hand leaves frame | Grab released, node stays where dropped |

**Open-palm detection** (`is_open_palm`): all four fingers (index → pinky) must each satisfy at least one of:
1. Wrist-to-tip distance > wrist-to-PIP × 1.08
2. Tip y-coordinate < PIP y-coordinate (tip above PIP in image space)

**Grab tracking**: locked to the hand's `handedness` string, not its frame-order index, so detection-order jitter never drops an active grab.

**Camera hand**: whichever detected hand is *not* in open-palm state. If all hands are open-palm, camera freezes.
