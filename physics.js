// physics.js


// // Constants must act as the "Source of Truth" for both Main and Worker threads.
// const NUM_STEPS = 100000; 
// const TANGENT_LENGTH = 200;
// const POINT_SELECTION_MARGIN = 20;
// const ROPE_DAMPING = 0.85; // Simulates air resistance (lower = more friction)
// const ROPE_K = 0.05;       // Spring stiffness (higher = snappier)
// const WIND_PARALLAX_CONST = 0.3;
// const TANGENT_COUNT = 6;

// --- VECTOR MATH UTILS ---
// Basic vector class to handle 2D positions and velocities.
class vector2D {
    constructor(x, y) { this.x = x; this.y = y; }
}

function add(a, b) { return new vector2D(a.x + b.x, a.y + b.y); }
function sub(a, b) { return new vector2D(a.x - b.x, a.y - b.y); }
function mult(a, m) { return new vector2D(a.x * m, a.y * m); }
function mag(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }

function normalize(a) {
    let m = mag(a); 
    if (m === 0) return new vector2D(0, 0);
    return new vector2D(a.x / m, a.y / m);
}

function dist(a, b) { return Math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2); }

// --- CONTROL POINT CLASS ---
// Handles the physics state for a single point (Position, Velocity, Base Position).
class ControlPoint {
    constructor(x, y, isFixed = false) {
        this.pos = new vector2D(x, y);
        this.basePos = new vector2D(x, y); // The "home" position the spring pulls towards
        this.vel = new vector2D(0, 0);
        this.isFixed = isFixed;
        
        this.isDragging = false;
        this.isChanging = false;
        
        this.k = ROPE_K;       
        this.damping = ROPE_DAMPING; 
    }

    // We pass world dimensions here because the Worker doesn't have access to 'window'.
    update(mousePos, mode, worldWidth, worldHeight) {
        // Right-Click behavior: Move the base position
        if(this.isChanging){
            this.basePos = mousePos;
            this.pos = mousePos;
            this.vel = new vector2D(0, 0);
            return;
        }

        if (this.isFixed) return;
        
        // Mouse Drag behavior
        if (this.isDragging) {
            this.pos = mousePos;
            this.vel = new vector2D(0, 0); // Reset velocity so it doesn't fly off when released
            return;
        }

        // Physics Simulation
        if(mode === "wd"){ // Wind Mode
            // Calculate wind offset based on mouse position relative to center
            let dx = (mousePos.x - worldWidth / 2) * WIND_PARALLAX_CONST;
            let dy = (mousePos.y - worldHeight / 2) * WIND_PARALLAX_CONST;

            let targetOffset = new vector2D(dx, dy);
            let target = add(this.basePos, targetOffset);

            // Hooke's Law: F = -k * x
            let displacement = sub(target, this.pos);
            let force = mult(displacement, this.k);

            // Euler Integration
            this.vel = add(this.vel, force);
            this.vel = mult(this.vel, this.damping); // Apply Friction
            this.pos = add(this.pos, this.vel);
        }
        else { // Default Mode
            let target = this.basePos; 
            let displacement = sub(target, this.pos);
            let force = mult(displacement, this.k);

            this.vel = add(this.vel, force);
            this.vel = mult(this.vel, this.damping);
            this.pos = add(this.pos, this.vel);
        }
    }
}

