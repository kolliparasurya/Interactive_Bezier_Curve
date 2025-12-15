// model.js

// --- CONFIGURATION ---
// I am initializing a Web Worker here. This moves the heavy physics calculations 
// off the main thread so the UI remains responsive even with 10,000+ points.
const worker = new Worker('worker.js');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const toggle = document.getElementById('windToggle');


// --- MEMORY ALLOCATION (SHARED ARRAY BUFFER) ---
// Float32 takes 4 bytes. We need to calculate exactly how much memory to allocate
// so the worker doesn't crash when trying to write to an out-of-bounds index.
const bytesPerFloat = 4;
const inputBytes = 8 * bytesPerFloat; // 4 points * 2 coords (x,y)

// Double Buffering Strategy:
// I allocated space for TWO curves (Buffer A and Buffer B).
// While the Main thread reads from one, the Worker writes to the other.
// This prevents "Screen Tearing" (seeing a half-updated line).
const singleCurveBytes = (NUM_STEPS * 2) * bytesPerFloat;
const totalCurveBytes = singleCurveBytes * 2; 

const tangentBytes = (TANGENT_COUNT * 4) * bytesPerFloat;
// Adding 1024 bytes of padding just to be safe against overflows.
const totalSize = inputBytes + totalCurveBytes + tangentBytes + 1024;

let sharedBuffer;
try {
    // SharedArrayBuffer allows both threads to read/write the same memory address.
    // This is much faster than copying data with postMessage().
    sharedBuffer = new SharedArrayBuffer(totalSize); 
} catch(e) {
    console.error("SharedArrayBuffer Error: Secure Context Required (HTTPS/Localhost)");
    throw e;
}


// --- MEMORY VIEWS ---
// Creating "Views" to interpret the raw binary data as Float numbers.

// 1. Inputs (P0-P3): The Main thread writes mouse positions here for the Worker to see.
const inputView = new Float32Array(sharedBuffer, 0, 8);

// 2. Curve Views (Double Buffered):
const CURVE_OFFSET_A = 32;
// Buffer B starts exactly where Buffer A ends.
const CURVE_OFFSET_B = 32 + (NUM_STEPS * 2 * 4);
const curveViewA = new Float32Array(sharedBuffer, CURVE_OFFSET_A, NUM_STEPS * 2);
const curveViewB = new Float32Array(sharedBuffer, CURVE_OFFSET_B, NUM_STEPS * 2);

// 3. Tangents:
const TANGENT_OFFSET = CURVE_OFFSET_B + (NUM_STEPS * 2 * 4); 
const tangentView = new Float32Array(sharedBuffer, TANGENT_OFFSET, TANGENT_COUNT * 4);

// --- GLOBAL STATE ---
let width, height; // Defined globally so animate() can see them
let MODE = "d";    // 'd' = Default, 'wd' = Wind
let mouse = { x: 0, y: 0 };
let draggingIdx = -1; // -1 means no point is selected
let changingIdx = -1; // For right-click interactions

// Synchronization:
// 0 = Draw Buffer A, 1 = Draw Buffer B.
let activeBufferIndex = 0;
let isWorkerBusy = false; // Prevents sending new jobs if the worker is still thinking.

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    
    // Send the memory configuration to the worker so it knows where to write.
    worker.postMessage({
        type: 'INIT',
        buffer: sharedBuffer,
        payload: { width, height, CURVE_OFFSET_A, CURVE_OFFSET_B, TANGENT_OFFSET }
    });
}

// --- INPUT HANDLING ---
toggle.addEventListener('change', (e) => {
    MODE = e.target.checked ? "wd" : "d";
});

window.addEventListener('mousemove', e => {
    mouse = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mousedown', e => {
    if(e.button !== 0) return; // Left click only
    mouse = { x: e.clientX, y: e.clientY };
    
    // Hit Detection:
    // I check the distance between the mouse and the points in 'inputView'.
    // Only points 1 and 2 (indices 1 and 2) are movable.
    for(let i=0; i<4; i++){
        let px = inputView[i*2];
        let py = inputView[i*2+1];
        let d = Math.sqrt((px - mouse.x)**2 + (py - mouse.y)**2);
        
        if( (i === 1 || i === 2) && d < POINT_SELECTION_MARGIN ){
            draggingIdx = i;
        }
    }
});

window.addEventListener('mouseup', () => {draggingIdx = -1, changingIdx = -1;});

window.addEventListener('contextmenu', e => {
    e.preventDefault(); // Stop the default browser menu
    let rx = e.clientX, ry = e.clientY;
    for(let i=0; i<4; i++){
        let px = inputView[i*2];
        let py = inputView[i*2+1];
        let d = Math.sqrt((px - rx)**2 + (py - ry)**2);
        if( d < POINT_SELECTION_MARGIN ){
            changingIdx = i;
        }
    }
});

window.addEventListener('resize', resize);


// --- RENDER LOOP ---
worker.onmessage = function(e){
    if(e.data.type === 'DONE'){
        isWorkerBusy = false;
        // The worker tells us which buffer (A or B) contains the finished frame.
        activeBufferIndex = e.data.finishedBufferIndex;
    }
}

function animate(){
    ctx.clearRect(0, 0, width, height);

    if(!isWorkerBusy){
        isWorkerBusy = true;
        // Swap Logic: If we are drawing Buffer 0, tell Worker to write to Buffer 1.
        // This ensures we never read and write to the same memory simultaneously.
        const writeToIndex = (activeBufferIndex === 0) ? 1 : 0;
        
        worker.postMessage({
            type: 'FRAME',
            payload: {
                mouse: mouse,
                mode: MODE,
                width: width,
                height: height,
                draggingIdx: draggingIdx,
                changingIdx: changingIdx,
                writeBufferIndex: writeToIndex
            }
        });
    }

    // Select the "Ready" buffer to draw
    const currentView = (activeBufferIndex === 0) ? curveViewA : curveViewB;

    // Draw the Bezier Curve
    ctx.beginPath();
    // Safety check: Don't draw if the buffer is empty/uninitialized (0,0)
    if(currentView[0] !== 0 || currentView[1] !== 0){
        ctx.moveTo(currentView[0], currentView[1]);
        
        // OPTIMIZATION: Step by 10 (or more) instead of 2.
        // 100,000 points -> Draw 10,000 segments.
        // Visually, it looks EXACTLY the same, but it's 10x faster for Canvas.
        const STRIDE = 10; 
        
        // Multiply by 2 because the array is flat [x,y, x,y...]
        const step = STRIDE * 2; 

        for(let i = 2; i < currentView.length; i += step){
            ctx.lineTo(currentView[i], currentView[i+1]);
        }
        
        // Ensure we connect the very last point so the line doesn't fall short
        const lastIdx = currentView.length - 2;
        ctx.lineTo(currentView[lastIdx], currentView[lastIdx+1]);

        ctx.strokeStyle = 'white';
        ctx.lineWidth = 4;
        ctx.stroke();
    }

    // Draw Tangents (Red lines)
    ctx.strokeStyle = '#FFA500';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let i = 0; i < tangentView.length; i+=4){
        // Skip empty memory
        if(tangentView[i] === 0 && tangentView[i+2] === 0) continue;
        ctx.moveTo(tangentView[i], tangentView[i + 1]);
        ctx.lineTo(tangentView[i + 2], tangentView[i + 3]);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = '#FFA500';

for (let i = 0; i < tangentView.length; i += 4) {
    // Skip empty memory
    if (tangentView[i] === 0 && tangentView[i + 2] === 0) continue;

    // IMPORTANT: Move to the starting edge of the circle to avoid connecting lines
    // Arc starts at 0 radians (3 o'clock), so we move to x + radius
    ctx.moveTo(tangentView[i] + 4, tangentView[i + 1]); 
    
    ctx.arc(tangentView[i], tangentView[i + 1], 4, 0, Math.PI * 2);
}
ctx.fill();

    drawControlStructure();
    requestAnimationFrame(animate);
}

function drawControlStructure() {
    // Read the current positions directly from shared memory
    let p0 = { x: inputView[0], y: inputView[1] };
    let p1 = { x: inputView[2], y: inputView[3] };
    let p2 = { x: inputView[4], y: inputView[5] };
    let p3 = { x: inputView[6], y: inputView[7] };
    
    // VISUAL OVERRIDE (Latency Hiding):
    // Even if the physics worker is slightly behind, I force the point 
    // to stick to the mouse cursor visually. This makes dragging feel instant.
    if (draggingIdx === 1) p1 = mouse;
    if (draggingIdx === 2) p2 = mouse;

    let pts = [p0, p1, p2, p3];

    // Draw Hull (Gray lines connecting points)
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Control Points
    pts.forEach((p, i) => {
        ctx.fillStyle = (i === 0 || i === 3) ? '#ff6b6b' : '#51cf66';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.fillText(`P${i}`, p.x + 12, p.y - 12);
    });
}

// Start
resize(); // Trigger first resize to set width/height
animate();