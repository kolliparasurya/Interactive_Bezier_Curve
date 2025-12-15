// worker.js
importScripts('utils.js');
importScripts('physics.js');


// These views allow the worker to write directly into the shared memory
let inputView, curveViewA, curveViewB, tangentView;

// 'points' holds the REAL physics state. 
// The main thread only ever sees copies or read-only views of this data.
let points = []; 

self.onmessage = function(e){
    let { type, payload, buffer } = e.data;

    switch(type){
        case 'INIT':
            // One-time setup: link the memory and create physics objects
            initialize(buffer, payload); 
            self.postMessage({type: 'DONE', finishedBufferIndex: 0});
            break;
            
        case 'FRAME':
            // 1. Run Physics (Springs, Wind, etc.)
            updatePhysics(payload);
            
            // 2. Calculate Bezier Curve
            // Crucial: We write to the specific buffer (A or B) requested by Main.
            findCurvePoints(payload.writeBufferIndex);
            
            // 3. Calculate Tangents
            findTangentPoints();
            
            // 4. Notify Main
            self.postMessage({type: 'DONE', finishedBufferIndex: payload.writeBufferIndex});
            break;
            
        default:
            console.error('Worker Error:', type);
    }
}

function initialize(buffer, config){
    inputView = new Float32Array(buffer, 0, 8);
    
    // Setting up the two buffers for double-buffering
    curveViewA = new Float32Array(buffer, config.CURVE_OFFSET_A, NUM_STEPS*2);
    curveViewB = new Float32Array(buffer, config.CURVE_OFFSET_B, NUM_STEPS*2);
    
    tangentView = new Float32Array(buffer, config.TANGENT_OFFSET, TANGENT_COUNT*4);
    
    const { width, height } = config;
    const cx = width/2, cy = height/2, s = Math.min(width,height)*0.6;
    
    // Create the physics objects using the Class from physics.js
    let p0 = new ControlPoint(cx - s/2, cy + s/4, true);
    let p1 = new ControlPoint(cx - s/6, cy - s/2);
    let p2 = new ControlPoint(cx + s/6, cy - s/2);
    let p3 = new ControlPoint(cx + s/2, cy + s/4, true);
    points = [p0, p1, p2, p3];
}

function updatePhysics(payload) {
    const { mouse, mode, width, height, draggingIdx, changingIdx } = payload;

    points.forEach((p, i) => {
        // Update interaction flags based on what Main told us
        p.isDragging = (i === draggingIdx);
        p.isChanging = (i === changingIdx);
        
        // Execute the physics math
        p.update(mouse, mode, width, height);

        // Write the new positions back to Shared Memory 
        // so the Main thread can draw the green/red circles correctly.
        inputView[i*2]     = p.pos.x;
        inputView[i*2 + 1] = p.pos.y;
    });
}

function findCurvePoints(bufferIndex){
    // Select the correct buffer
    const targetView = (bufferIndex === 0) ? curveViewA : curveViewB;

    // Cache positions to local variables (Faster than accessing array repeatedly)
    const p0x = points[0].pos.x, p0y = points[0].pos.y;
    const p1x = points[1].pos.x, p1y = points[1].pos.y;
    const p2x = points[2].pos.x, p2y = points[2].pos.y;
    const p3x = points[3].pos.x, p3y = points[3].pos.y;

    // Pre-calculate polynomial coefficients (The "A, B, C" of the curve)
    // Formula: P(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + ...
    // Optimized: P(t) = A*t^3 + B*t^2 + C*t + P0
    // This reduces math operations inside the loop significantly.
    
    const cx = 3 * (p1x - p0x);
    const bx = 3 * (p2x - p1x) - cx;
    const ax = p3x - p0x - cx - bx;

    const cy = 3 * (p1y - p0y);
    const by = 3 * (p2y - p1y) - cy;
    const ay = p3y - p0y - cy - by;

    let t, t2, t3;

    for (let i = 0; i <= NUM_STEPS; i++) {
        t = i / NUM_STEPS;
        t2 = t * t;
        t3 = t2 * t;

        // Direct math, NO new objects created!
        targetView[i*2]     = (ax * t3) + (bx * t2) + (cx * t) + p0x;
        targetView[i*2 + 1] = (ay * t3) + (by * t2) + (cy * t) + p0y;
    }
}

function findTangentPoints() {
    // 1. Local Cache (Avoid accessing objects in the loop)
    const p0x = points[0].pos.x, p0y = points[0].pos.y;
    const p1x = points[1].pos.x, p1y = points[1].pos.y;
    const p2x = points[2].pos.x, p2y = points[2].pos.y;
    const p3x = points[3].pos.x, p3y = points[3].pos.y;

    // 2. Pre-calculate Coefficients (A, B, C)
    // We use the same coefficients for Position (at^3 + bt^2...) 
    // AND for the Tangent Slope (3at^2 + 2bt...)
    
    // X Coefficients
    const cx = 3 * (p1x - p0x);
    const bx = 3 * (p2x - p1x) - cx;
    const ax = p3x - p0x - cx - bx;

    // Y Coefficients
    const cy = 3 * (p1y - p0y);
    const by = 3 * (p2y - p1y) - cy;
    const ay = p3y - p0y - cy - by;

    let t, t2, ox, oy, tx, ty, mag, idx;

    for (let i = 0; i <= TANGENT_COUNT; i++) {
        t = i / TANGENT_COUNT;
        t2 = t * t;

        // 3. Calculate Origin (Position on Curve)
        // Formula: P(t) = at^3 + bt^2 + ct + p0
        ox = (ax * t * t2) + (bx * t2) + (cx * t) + p0x;
        oy = (ay * t * t2) + (by * t2) + (cy * t) + p0y;

        // 4. Calculate Tangent Vector (Derivative of Position)
        // Formula: P'(t) = 3at^2 + 2bt + c
        tx = (3 * ax * t2) + (2 * bx * t) + cx;
        ty = (3 * ay * t2) + (2 * by * t) + cy;

        // 5. Normalize (Make length 1) and Scale (to TANGENT_LENGTH)
        mag = Math.sqrt(tx * tx + ty * ty);
        
        if (mag > 0.0001) { // Safety check to prevent divide by zero
            // Optimization: Combine division and multiplication
            let scale = TANGENT_LENGTH / mag; 
            tx *= scale;
            ty *= scale;
        } else {
            tx = 0; 
            ty = 0;
        }

        // 6. Store [Origin X, Origin Y, Tip X, Tip Y]
        idx = i * 4;
        tangentView[idx]     = ox;
        tangentView[idx + 1] = oy;
        tangentView[idx + 2] = ox + tx;
        tangentView[idx + 3] = oy + ty;
    }
}