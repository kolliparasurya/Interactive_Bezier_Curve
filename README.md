# Interactive Bézier Rope Simulation

## 📝 Overview

This project is a **high-performance, interactive simulation of a cubic Bézier curve that behaves like a physical rope**.  
It demonstrates advanced graphics and systems programming concepts by implementing **custom physics**, **manual Bézier mathematics**, and **multi-threaded parallelism** from scratch.

The simulation renders a cubic Bézier curve defined by four control points:

- \( P_0 \) and \( P_3 \): Fixed endpoints
- \( P_1 \) and \( P_2 \): Dynamic control points

The internal control points react to mouse interaction and simulated wind forces using a **custom Spring–Mass–Damper physics model**.

---

## 🚀 Key Features

- **Real-Time Physics**

  - Hooke’s Law–based spring forces
  - Euler integration for motion updates
  - Damping to prevent infinite oscillations

- **High-Performance Architecture**

  - Heavy computation runs inside a Web Worker
  - Main thread remains responsive at high frame rates

- **Zero-Copy Communication**

  - Uses `SharedArrayBuffer` for shared memory access
  - Eliminates costly `postMessage` data copying
  - Sustains ~60 FPS with up to **100,000 Bézier steps**

- **Double Buffering**

  - Prevents race conditions between threads
  - Eliminates visual tearing during rendering

- **Manual Mathematics**

  - All Bézier interpolation and derivatives implemented manually
  - No external math or physics libraries used

- **Interactive Controls**
  - Drag control points
  - Move anchor positions
  - Toggle wind physics in real time

---

## 🛠 Technical Architecture

### 1️⃣ Multi-Threaded Pipeline

The application follows a **Producer–Consumer architecture**:

#### Main Thread (`model.js`)

- Handles user input (mouse & UI)
- Renders the Bézier curve using the Canvas API
- Consumes geometry data from shared memory

#### Worker Thread (`worker.js`)

- Executes the physics engine
- Updates control point positions
- Computes Bézier subdivision and tangent vectors

---

### 2️⃣ Zero-Copy Shared Memory

To achieve smooth rendering at high resolutions:

- A `SharedArrayBuffer` is allocated once
- Both threads read/write into the same memory region
- No serialization or deep copying occurs
- Enables high-frequency physics and rendering updates

---

### 3️⃣ Mathematical Optimization

Standard cubic Bézier equations require repeated power computations.  
To reduce CPU usage, the cubic equation is expanded into polynomial form.

#### Bézier Position

\[
B(t) = At^3 + Bt^2 + Ct + P_0
\]

#### Tangent (Derivative)

\[
B'(t) = 3At^2 + 2Bt + C
\]

- Coefficients \( A, B, C \) are precomputed per frame
- Significantly reduces math operations inside tight loops

---

## 🧮 Physics Model

The internal control points \( P_1 \) and \( P_2 \) are treated as **particles attached to base positions** via virtual springs.

### Forces Applied

- **Spring Force**
  F*s = -k * \(P\{current\} - P\_{base}\)
- **Damping**

  - Simulates air resistance
  - Stabilizes oscillations

- **Wind Effect**
  - Applies a parallax-based offset to the base position
  - Creates realistic wind-driven rope motion

---

## 📂 Project Structure

```
├── server.py # Secure HTTP server (COOP + COEP headers)
├── index.html # UI entry point
├── model.js # Main thread: input handling & rendering
├── worker.js # Worker thread: physics & geometry
├── physics.js # Shared vector math and control point physics
├── utils.js # Simulation constants (steps, tension, damping)
└── README.md
```

---

## 📦 Installation & Usage

### Prerequisites

Due to browser security requirements for `SharedArrayBuffer`, the project **must be served with specific HTTP headers**:

- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Embedder-Policy`

Opening `index.html` directly in a file browser will **not work**.

---

### ▶️ Running the Simulation

1. Ensure **Python 3** is installed
2. Open a terminal in the project directory
3. Start the secure local server:
   ```bash
   python server.py
   ```
4. Open your browser to: http://localhost:3000

## 🖱 Controls

- **Left Click + Drag:** Grab and pull the green control points (**P₁**, **P₂**)
- **Right Click + Drag:** Move the anchor positions (changes where the springs attach)
- **Toggle Switch:** Enable or disable the **Wind** physics effect
