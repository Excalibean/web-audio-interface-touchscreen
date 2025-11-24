const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('audio-file');
    const speedSlider = document.getElementById('speed-slider');
    const speedLabel = document.getElementById('speed-label');
    const playButton = document.getElementById('play-button');
    const rewindButton = document.getElementById('rewind-button');
    const fastForwardButton = document.getElementById('fast-forward-button');
    const currentFile = document.getElementById('current-file');
    const chunkSizeInput = document.getElementById('chunk-size');
    const chunkSizeLabel = document.getElementById('chunk-size-label');
    const rewindStepInput = document.getElementById('rewind-step');
    const rewindStepLabel = document.getElementById('rewind-step-label');
    const rewindPeriod = document.getElementById('rewind-freq');
    const rewindPeriodLabel = document.getElementById('rewind-freq-label');
    const rewindOverlap = document.getElementById('rewind-overlap');
    const rewindOverlapLabel = document.getElementById('rewind-overlap-label');
    const rewindPlaybackSpeed = document.getElementById('rewind-playback-speed');
    const rewindPlaybackSpeedLabel = document.getElementById('rewind-playback-speed-label');
    const baseBPMInput = document.getElementById('1x-bpm');
    const baseBPMLabel = document.getElementById('1x-bpm-label');
    const progressBar = document.getElementById('progress-bar');
    const currentTimeDisplay = document.getElementById('current-time');
    const durationTimeDisplay = document.getElementById('duration-time');
    
    // Touchscreen control elements
    const touchControlArea = document.getElementById('touch-control-area');
    const touchIndicator = document.getElementById('touch-indicator');
    const inputModeToggle = document.getElementById('input-mode-toggle');
    const inputModeLabel = document.getElementById('input-mode-label');
    const leftZoneLabel = document.getElementById('left-zone-label');
    const rightZoneLabel = document.getElementById('right-zone-label');

    //TO DO: Add alpha, decay timeout, refine gestures, and integrate forward circle/swiping gestures
    // Use, take notes, and debug session (simulate user experience)
    // Speed = Speed - alpha * (Speed - Target)
    // Target = Amplitude * Gesture
    // 

    let audio = null;
    let currentAudio = null;
    let audioContext = null;
    let rewindInterval = null;
    let audioBuffer = null;
    let isSeeking = false;
    let isRewinding = false;
    let wasPlayingBeforeRewind = false;
    let isTouching = false; // Track if user is touching the control zone
    let inputMode = 'tap'; // 'tap' or 'scroll' - Defaults to 'tap'
    
    // Scroll detection variables
    let scrollHistory = []; // Store recent scroll events with timestamps
    let lastScrollUpdateTime = 0;
    let currentScrollDirection = null; // 'up' or 'down' or null
    const SCROLL_HISTORY_WINDOW_MS = 200; // Consider scroll events within 200ms
    const SCROLL_UPDATE_INTERVAL_MS = 50; // Update scroll speed every 50ms
    const SCROLL_SMOOTHING = 0.3; // Smoothing factor for scroll speed
    const MAX_SCROLL_SPEED = 2400;
    const SCROLL_SENSITIVITY_FACTOR = 5; // Higher = requires more scrolling to reach extremes
    const SLOW_SCROLL_THRESHOLD = 0.05;
    const FAST_SCROLL_THRESHOLD = 0.85;
    const EXTREME_SCROLL_THRESHOLD = 0.97;
    const MAX_PLAYBACK_RATE = 4;
    const SCROLL_STOP_DEBOUNCE_MS = 300;
    const SCROLL_DECAY_MIN_DELAY_MS = 2000;
    const SCROLL_DECAY_MAX_DELAY_MS = 8000;
    const SCROLL_DECAY_MAX_SESSION_MS = 6000;
    
    // Touch scroll detection (for mobile)
    let touchScrollStartY = null;
    let touchScrollStartTime = null;
    let touchScrollLastY = null;
    let touchScrollLastTime = null;
    let scrollSessionStartTime = null;
    let scrollDecayStartTimeout = null;
    
    // Gesture detection variables
    let touchPoints = []; // Store touch positions for gesture detection
    let lastTapTime = 0;
    let tapCount = 0;
    let tapTimes = []; // Store timestamps of recent taps
    const TAP_WINDOW_MS = 2000; // Consider taps within 2 seconds for BPM calculation
    const CIRCLE_POINTS_NEEDED = 10; // Number of points needed to detect a circle
    const CIRCLE_UPDATE_POINTS = 5; // Update circle speed more frequently
    let gestureMode = null; // 'tap' or 'circle' or null
    let circleDirection = null; // 'clockwise' or 'counterclockwise'
    let lastGestureTime = 0;
    const GESTURE_TIMEOUT_MS = 3000; // If no gesture for 1 second, decay to default
    const DEFAULT_DECAY_SPEED = 0.5; // Speed to decay to when no input
    let decayTimeout = null;
    let decayIntervalHandle = null;
    let lastCircleUpdateTime = 0; // Track when we last updated circle speed
    const CIRCLE_UPDATE_INTERVAL_MS = 100; // Update circle speed every 100ms
    
    const FADE_TIME = 0.04;
    const DEFAULT_TRACK = 'default_audiobook.mp3';

    // leaky integrator parameters for speed slider (Low Pass Filter)
    const TICK_MS = 50; // Update every 50ms
    let speedTarget = 1.0; // Target speed from slider
    let speedActual = 1.0; // Actual speed (smoothed)
    let speedIntegratorInterval = null;

    // Gesture detection functions
    function calculateAngle(p1, p2) {
        return Math.atan2(p2.y - p1.y, p2.x - p1.x);
    }

    function detectCircleGesture() {
        if (touchPoints.length < CIRCLE_POINTS_NEEDED) return null;
        
        // Use the last N points to detect circular motion
        const recentPoints = touchPoints.slice(-CIRCLE_POINTS_NEEDED);
        let totalAngleChange = 0;
        
        // Calculate cumulative angle changes
        for (let i = 2; i < recentPoints.length; i++) {
            const angle1 = calculateAngle(recentPoints[i-2], recentPoints[i-1]);
            const angle2 = calculateAngle(recentPoints[i-1], recentPoints[i]);
            let angleDiff = angle2 - angle1;
            
            // Normalize angle difference to -PI to PI
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            totalAngleChange += angleDiff;
        }
        
        // Determine if it's a circle and which direction
        const threshold = Math.PI / 2; // Need at least 90 degrees of rotation
        
        if (totalAngleChange > threshold) {
            return 'clockwise';
        } else if (totalAngleChange < -threshold) {
            return 'counterclockwise';
        }
        
        return null;
    }

    let smoothedCircleSpeed = 0;
    const CIRCLE_SPEED_SMOOTHING = 0.3; // 0-1, lower = smoother (like your speed filter!)

    function calculateCircleSpeed() {
        // Calculate how fast circles are being drawn
        if (touchPoints.length < CIRCLE_UPDATE_POINTS) return smoothedCircleSpeed;
        
        const recentPoints = touchPoints.slice(-CIRCLE_UPDATE_POINTS);
        const timeSpan = (recentPoints[recentPoints.length - 1].time - recentPoints[0].time) / 1000; // in seconds
        
        if (timeSpan === 0) return smoothedCircleSpeed;
        
        // Calculate total angle change in the recent points
        let totalAngleChange = 0;
        for (let i = 2; i < recentPoints.length; i++) {
            const angle1 = calculateAngle(recentPoints[i-2], recentPoints[i-1]);
            const angle2 = calculateAngle(recentPoints[i-1], recentPoints[i]);
            let angleDiff = angle2 - angle1;
            
            // Normalize angle difference to -PI to PI
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            totalAngleChange += Math.abs(angleDiff);
        }
        
        // Calculate angular velocity (radians per second)
        const angularVelocity = totalAngleChange / timeSpan;
        
        // Convert to circles per second (2π radians = 1 circle)
        const rawCirclesPerSecond = angularVelocity / (2 * Math.PI);
        
        // Apply exponential smoothing (same technique as your speed integrator!)
        smoothedCircleSpeed = smoothedCircleSpeed + CIRCLE_SPEED_SMOOTHING * (rawCirclesPerSecond - smoothedCircleSpeed);
        
        return smoothedCircleSpeed;
    }

    function calculateBPMFromTaps() {
        // Clean up old taps outside the window
        const now = Date.now();
        tapTimes = tapTimes.filter(time => now - time < TAP_WINDOW_MS);
        
        if (tapTimes.length < 2) return null;
        
        // Calculate average interval between taps
        let totalInterval = 0;
        for (let i = 1; i < tapTimes.length; i++) {
            totalInterval += tapTimes[i] - tapTimes[i-1];
        }
        const avgInterval = totalInterval / (tapTimes.length - 1);
        
        // Convert to BPM
        const bpm = 60000 / avgInterval; // 60000ms = 1 minute
        return bpm;
    }

    function bpmToSpeed(bpm) {
        // Map BPM to playback speed
        // Use adjustable base BPM from slider
        const baseBPM = parseFloat(baseBPMInput?.value || 60); // BPM that corresponds to 1x speed
        return Math.max(0.25, Math.min(4, bpm / baseBPM));
    }

    function circleSpeedToRewindSpeed(circleSpeed) {
        // Map circles per second directly to playback speed
        // 1 circle/sec = -1x speed (baseline)
        // Faster circles = faster rewind (more negative)
        const maxCirclesPerSec = 4.0; // Maximum circles per second we'll detect
        const maxSpeed = -4.0; // Maximum rewind speed
        const minCirclesForRewind = 0.1; // Minimum circle speed to trigger rewind (slower than this = ignored)
        
        // Clamp circle speed
        const clampedSpeed = Math.max(0, Math.min(circleSpeed, maxCirclesPerSec));
        
        // Only apply rewind if above minimum threshold
        if (clampedSpeed < minCirclesForRewind) {
            return 0; // No rewind for very slow movements
        }
    
        const rewindSpeed = -clampedSpeed;
        return Math.max(maxSpeed, rewindSpeed); // Clamp to max speed
    }

        function circleSpeedToForwardSpeed(circleSpeed) {
        // Map circles per second directly to playback speed
        // 1 circle/sec = 1x speed (baseline)
        // Faster circles = faster forward playback (more positive)
        const maxCirclesPerSec = 4.0; // Maximum circles per second we'll detect
        const maxSpeed = 4.0; // Maximum forward speed
        const minCirclesForForward = 0.1; // Minimum circle speed to trigger forward playback
        
        // Clamp circle speed
        const clampedSpeed = Math.max(0, Math.min(circleSpeed, maxCirclesPerSec));
        
        // Only apply forward if above minimum threshold
        if (clampedSpeed < minCirclesForForward) {
            return 0; // No forward for very slow movements
        }
    
        
        return Math.min(maxSpeed, clampedSpeed); // Clamp to max speed
    }

    // Bell curve function to map scroll speed to playback speed
    function scrollSpeedToPlaybackSpeed(rawScrollSpeed) {
        const normalizedSpeed = Math.min(
            1,
            Math.abs(rawScrollSpeed) / (MAX_SCROLL_SPEED * SCROLL_SENSITIVITY_FACTOR)
        );
        const mu = 0.5;
        const sigma = 0.25;
        const bellValue = Math.exp(-Math.pow((normalizedSpeed - mu) / sigma, 2) / 2);
        let playbackSpeed;
        
        if (normalizedSpeed < SLOW_SCROLL_THRESHOLD) {
            playbackSpeed = (normalizedSpeed / SLOW_SCROLL_THRESHOLD) * 0.25; // Glide toward 0x
        } else if (normalizedSpeed < FAST_SCROLL_THRESHOLD) {
            // Keep most scroll speeds clustered near 1x using bell curve
            playbackSpeed = 0.6 + bellValue * 0.6; // ≈0.6x to 1.2x
        } else if (normalizedSpeed < EXTREME_SCROLL_THRESHOLD) {
            const fastFactor = (normalizedSpeed - FAST_SCROLL_THRESHOLD) / (EXTREME_SCROLL_THRESHOLD - FAST_SCROLL_THRESHOLD);
            playbackSpeed = 1 + fastFactor; // Approach 2x as scroll accelerates
        } else {
            const extremeFactor = (normalizedSpeed - EXTREME_SCROLL_THRESHOLD) / (1 - EXTREME_SCROLL_THRESHOLD);
            playbackSpeed = 2 + extremeFactor * 2; // Fade toward 4x
        }
        
        playbackSpeed = Math.min(MAX_PLAYBACK_RATE, Math.max(0, playbackSpeed));
        return rawScrollSpeed > 0 ? playbackSpeed : -playbackSpeed;
    }

    // Calculate scroll speed from scroll history
    let smoothedScrollSpeed = 0;
    function calculateScrollSpeed() {
        const now = Date.now();
        scrollHistory = scrollHistory.filter(event => now - event.time < SCROLL_HISTORY_WINDOW_MS);
        
        if (scrollHistory.length < 2) {
            smoothedScrollSpeed = smoothedScrollSpeed * 0.9;
            return smoothedScrollSpeed;
        }
        
        // Since we reset history on direction change, all events should be in the same direction
        const firstEvent = scrollHistory[0];
        const lastEvent = scrollHistory[scrollHistory.length - 1];
        const totalDelta = lastEvent.cumulativeDelta;
        const timeSpan = (lastEvent.time - firstEvent.time) / 1000;
        
        if (timeSpan === 0) return smoothedScrollSpeed;
        
        const rawSpeed = totalDelta / timeSpan;
        smoothedScrollSpeed = smoothedScrollSpeed + SCROLL_SMOOTHING * (rawSpeed - smoothedScrollSpeed);
        
        return smoothedScrollSpeed;
    }

    function registerScrollActivity() {
        if (scrollSessionStartTime === null) {
            scrollSessionStartTime = Date.now();
        }
        if (decayTimeout) {
            clearTimeout(decayTimeout);
            decayTimeout = null;
        }
        if (decayIntervalHandle) {
            clearInterval(decayIntervalHandle);
            decayIntervalHandle = null;
        }
        if (scrollDecayStartTimeout) {
            clearTimeout(scrollDecayStartTimeout);
            scrollDecayStartTimeout = null;
        }
    }

    function scheduleScrollDecayAfterInactivity() {
        if (scrollDecayStartTimeout) {
            clearTimeout(scrollDecayStartTimeout);
        }
        
        scrollDecayStartTimeout = setTimeout(() => {
            const now = Date.now();
            const sessionDuration = scrollSessionStartTime ? now - scrollSessionStartTime : 0;
            scrollSessionStartTime = null;
            scrollDecayStartTimeout = null;
            
            const normalizedDuration = Math.min(1, sessionDuration / SCROLL_DECAY_MAX_SESSION_MS);
            const decayDelay = SCROLL_DECAY_MIN_DELAY_MS + 
                normalizedDuration * (SCROLL_DECAY_MAX_DELAY_MS - SCROLL_DECAY_MIN_DELAY_MS);
            
            startDecayToDefault(decayDelay);
        }, SCROLL_STOP_DEBOUNCE_MS);
    }

    function detectTap(x, y) {
        const now = Date.now();
        
        // Check if this is a tap (small movement within a short time)
        if (touchPoints.length < 3) {
            // Register tap
            tapTimes.push(now);
            tapCount++;
            return true;
        }
        
        // Check if movement is small enough to be a tap
        const firstPoint = touchPoints[0];
        const distance = Math.sqrt(Math.pow(x - firstPoint.x, 2) + Math.pow(y - firstPoint.y, 2));
        
        if (distance < 30) { // 30px threshold for tap
            tapTimes.push(now);
            tapCount++;
            return true;
        }
        
        return false;
    }

    function startDecayToDefault(customDelay = GESTURE_TIMEOUT_MS) {
        // Clear any existing decay timeout
        if (decayTimeout) {
            clearTimeout(decayTimeout);
        }
        if (decayIntervalHandle) {
            clearInterval(decayIntervalHandle);
            decayIntervalHandle = null;
        }
        
        decayTimeout = setTimeout(() => {
            let decayInterval = null; // Store the interval reference
            
            // Instead of instantly setting speedTarget, gradually decay it
            decayInterval = setInterval(() => {
                let nextTarget = speedTarget;
                
                if (speedTarget < 0) {
                    const decayStep = 0.05; // How much to change per tick
                    nextTarget = Math.min(DEFAULT_DECAY_SPEED, speedTarget + decayStep);
                } else if (speedTarget > DEFAULT_DECAY_SPEED) {
                    const decayStep = 0.02; // Slower decay for forward speeds
                    nextTarget = Math.max(DEFAULT_DECAY_SPEED, speedTarget - decayStep);
                } else if (speedTarget < DEFAULT_DECAY_SPEED) {
                    const decayStep = 0.02;
                    nextTarget = Math.min(DEFAULT_DECAY_SPEED, speedTarget + decayStep);
                } else {
                    clearInterval(decayInterval);
                    decayIntervalHandle = null;
                }
                
                if (Math.abs(nextTarget - DEFAULT_DECAY_SPEED) < 0.01) {
                    nextTarget = DEFAULT_DECAY_SPEED;
                    clearInterval(decayInterval);
                    decayIntervalHandle = null;
                }
                
                setTargetSpeed(nextTarget);
                
            }, 100); // Update every 100ms for smooth decay
            decayIntervalHandle = decayInterval;
            
            // Reset gesture mode
            gestureMode = null;
            circleDirection = null;
            
        }, customDelay);
    }

    // Touchscreen control function (touch only maybe???, mouse works like touch control anyway)
    function handleTouchControl(event) {
        event.preventDefault(); //to prevent accidental scrolling (very very important)

        // Get area of touch zone, also checks for touch action in x and y calcs
        const rect = touchControlArea.getBoundingClientRect();
        const x = (event.type.includes('touch') ? event.touches[0].clientX : event.clientX) - rect.left;  //side coord of touch
        const y = (event.type.includes('touch') ? event.touches[0].clientY : event.clientY) - rect.top;   //vertical coord of touch
        
        // Store touch point for gesture detection
        const now = Date.now();
        touchPoints.push({ x, y, time: now });
        
        // Keep only recent points (last 2 seconds)
        touchPoints = touchPoints.filter(p => now - p.time < 2000);
        
        // Update last gesture time
        lastGestureTime = now;
        
        // Detect circle gesture direction (counter or clockwise)
        const direction = detectCircleGesture();
        
        if (direction) {
            const previousGestureMode = gestureMode; // Track previous mode
            const previousCircleDirection = circleDirection; // Track previous direction
            
            gestureMode = 'circle';
            circleDirection = direction;
            
            // Jump-start rewind when first entering counter-clockwise mode
            if (direction === 'counterclockwise' && 
                (previousGestureMode !== 'circle' || previousCircleDirection !== 'counterclockwise')) {
                // First time entering counter-clockwise mode - jump to -1x immediately (1 circle/sec baseline)
                setTargetSpeed(-1.0);
                speedActual = -1.0; // Set actual speed too, bypassing the integrator
                setActualSpeedLabel(speedActual);
            }
            
            // Jump-start forward when first entering clockwise mode
            if (direction === 'clockwise' && 
                (previousGestureMode !== 'circle' || previousCircleDirection !== 'clockwise')) {
                // First time entering clockwise mode - jump to 1x immediately (1 circle/sec baseline)
                setTargetSpeed(1.0);
                speedActual = 1.0; // Set actual speed too, bypassing the integrator
                setActualSpeedLabel(speedActual);
            }
            
            // Clear tap data when doing circles
            tapTimes = [];
        }
        
        // Continuously update circle speed if in circle mode
        if (gestureMode === 'circle' && circleDirection === 'counterclockwise') {
            // Update speed more frequently for responsive control
            if (now - lastCircleUpdateTime > CIRCLE_UPDATE_INTERVAL_MS) {
                const circleSpeed = calculateCircleSpeed();
                const rewindSpeed = circleSpeedToRewindSpeed(circleSpeed);
                setTargetSpeed(rewindSpeed);
                lastCircleUpdateTime = now;
            }
        } else if (gestureMode === 'circle' && circleDirection === 'clockwise') {
            // Clockwise - forward gesture
            if (now - lastCircleUpdateTime > CIRCLE_UPDATE_INTERVAL_MS) {
                const circleSpeed = calculateCircleSpeed();
                const forwardSpeed = circleSpeedToForwardSpeed(circleSpeed);
                setTargetSpeed(forwardSpeed);
                lastCircleUpdateTime = now;
            }
        }
        
        // Update touch indicator position
        if (touchIndicator) {
            touchIndicator.classList.add('active');
            touchIndicator.style.left = `${x - 30}px`; // Center the indicator (30px = half width)
            touchIndicator.style.top = `${y - 30}px`; // Center the indicator (30px = half height)
            
            // Change indicator color based on gesture mode and speed
            if (gestureMode === 'circle' && circleDirection === 'counterclockwise') {
                // Vary red intensity based on rewind speed
                const intensity = Math.abs(speedTarget / 2.0); // 0 to 1
                const red = Math.floor(255 * Math.max(0.4, intensity)); // At least 40% red
                touchIndicator.style.background = `rgba(${red}, 100, 100, 0.8)`;
            } else if (gestureMode === 'circle' && circleDirection === 'clockwise') {
                // Vary blue intensity based on forward speed
                const intensity = Math.abs(speedTarget / 2.0); // 0 to 1
                const blue = Math.floor(255 * Math.max(0.4, intensity)); // At least 40% blue
                touchIndicator.style.background = `rgba(100, 100, ${blue}, 0.8)`;
            } else if (gestureMode === 'tap') {
                touchIndicator.style.background = 'rgba(100, 255, 100, 0.8)'; // Green for tapping
            } else {
                touchIndicator.style.background = 'rgba(255, 255, 255, 0.8)'; // White default
            }
        }
    }

    function handleTouchStart(event) {
        isTouching = true;
        
        const rect = touchControlArea.getBoundingClientRect();
        const x = (event.type.includes('touch') ? event.touches[0].clientX : event.clientX) - rect.left;
        const y = (event.type.includes('touch') ? event.touches[0].clientY : event.clientY) - rect.top;
        const now = Date.now();
        
        if (inputMode === 'scroll') {
            // In scroll mode, track vertical touch movement
            event.preventDefault();
            touchScrollStartY = y;
            touchScrollStartTime = now;
            touchScrollLastY = y;
            touchScrollLastTime = now;
            scrollHistory = [];
            smoothedScrollSpeed = 0;
            currentScrollDirection = null; // Reset direction on new touch
            
            // Show indicator at touch position
            if (touchIndicator) {
                touchIndicator.classList.add('active');
                touchIndicator.style.left = `${x - 30}px`;
                touchIndicator.style.top = `${y - 30}px`;
                touchIndicator.style.background = 'rgba(255, 255, 255, 0.8)';
            }
        } else {
            // In tap mode, use existing gesture tracking
            // Reset gesture tracking
            touchPoints = [];
            gestureMode = null;
            circleDirection = null;
            smoothedCircleSpeed = 0;
            
            event.preventDefault();
            touchPoints.push({ x, y, time: now });
            
            // Show indicator at touch position
            if (touchIndicator) {
                touchIndicator.classList.add('active');
                touchIndicator.style.left = `${x - 30}px`;
                touchIndicator.style.top = `${y - 30}px`;
                touchIndicator.style.background = 'rgba(255, 255, 255, 0.8)'; // White default
            }
        }
        
        // Start decay timer on touch down (resets on gesture detected)
        startDecayToDefault();
    }

    function handleTouchMove(event) {
        if (isTouching) {
            // Clear decay timeout when movement is detected
            if (decayTimeout) {
                clearTimeout(decayTimeout);
                decayTimeout = null;
            }
            
            if (inputMode === 'tap') {
                handleTouchControl(event);
            } else if (inputMode === 'scroll') {
                // Handle touch-based scrolling for mobile
                event.preventDefault();
                const rect = touchControlArea.getBoundingClientRect();
                const y = (event.type.includes('touch') ? event.touches[0].clientY : event.clientY) - rect.top;
                const now = Date.now();
                
                if (touchScrollLastY !== null && touchScrollLastTime !== null) {
                    const deltaY = touchScrollLastY - y; // Positive = scrolling up, Negative = scrolling down
                    const deltaTime = now - touchScrollLastTime;
                    
                    if (deltaTime > 0) {
                        registerScrollActivity();
                        // Convert to pixels per second (invert deltaY so positive = scroll down)
                        const normalizedDelta = -deltaY; // Now positive = scroll down, negative = scroll up
                        
                        // Detect scroll direction (matching wheel event convention)
                        const newDirection = normalizedDelta > 0 ? 'down' : 'up';
                        
                        // If direction changed, reset scroll history to start fresh
                        if (currentScrollDirection !== null && currentScrollDirection !== newDirection) {
                            scrollHistory = [];
                            smoothedScrollSpeed = 0; // Reset smoothed speed when direction changes
                        }
                        
                        currentScrollDirection = newDirection;
                        
                        // Track cumulative scroll
                        let cumulativeDelta = normalizedDelta;
                        if (scrollHistory.length > 0) {
                            cumulativeDelta = scrollHistory[scrollHistory.length - 1].cumulativeDelta + normalizedDelta;
                        }
                        
                        scrollHistory.push({
                            time: now,
                            delta: normalizedDelta,
                            cumulativeDelta: cumulativeDelta
                        });
                        
                        // Update scroll speed calculation
                        if (now - lastScrollUpdateTime > SCROLL_UPDATE_INTERVAL_MS) {
                            const calculatedSpeed = calculateScrollSpeed();
                            const playbackSpeed = scrollSpeedToPlaybackSpeed(calculatedSpeed);
                            
                            setTargetSpeed(playbackSpeed);
                            lastScrollUpdateTime = now;
                            
                            // Update indicator color based on direction
                            if (touchIndicator) {
                                const indicatorY = Math.max(0, Math.min(rect.height - 60, y - 30));
                                touchIndicator.style.top = `${indicatorY}px`;
                                
                                if (playbackSpeed > 0) {
                                    // Forward (scroll down) - blue
                                    const intensity = Math.abs(playbackSpeed / 2.0);
                                    const blue = Math.floor(255 * Math.max(0.4, intensity));
                                    touchIndicator.style.background = `rgba(100, 100, ${blue}, 0.8)`;
                                } else if (playbackSpeed < 0) {
                                    // Backward (scroll up) - red
                                    const intensity = Math.abs(playbackSpeed / 2.0);
                                    const red = Math.floor(255 * Math.max(0.4, intensity));
                                    touchIndicator.style.background = `rgba(${red}, 100, 100, 0.8)`;
                                } else {
                                    touchIndicator.style.background = 'rgba(255, 255, 255, 0.8)';
                                }
                            }
                            
                            lastGestureTime = now;
                        }
                    }
                }
                
                touchScrollLastY = y;
                touchScrollLastTime = now;
                
                scheduleScrollDecayAfterInactivity();
            }
        }
    }

    function handleTouchEnd(event) {
        isTouching = false;
        
        const now = Date.now();
        
        // Reset touch scroll tracking
        if (inputMode === 'scroll') {
            touchScrollStartY = null;
            touchScrollStartTime = null;
            touchScrollLastY = null;
            touchScrollLastTime = null;
            currentScrollDirection = null; // Reset direction on touch end
        }
        
        // Only process tap gestures in tap mode
        if (inputMode === 'tap') {
            // Check if this was a tap gesture (quick touch and release)
            if (touchPoints.length > 0) {
                const firstPoint = touchPoints[0];
                const lastPoint = touchPoints[touchPoints.length - 1];
                const distance = Math.sqrt(
                    Math.pow(lastPoint.x - firstPoint.x, 2) + 
                    Math.pow(lastPoint.y - firstPoint.y, 2)
                );
                
                const touchDuration = now - firstPoint.time;
                
                // Only count as tap if:
                // 1. Small movement (< 30px)
                // 2. Quick release (< 200ms) - this prevents press-and-hold
                // 3. Not too many touch points (< 5) - prevents drag from being counted
                if (distance < 30 && touchDuration < 200 && touchPoints.length < 5) {
                    // Clear decay timeout for tap gesture
                    if (decayTimeout) {
                        clearTimeout(decayTimeout);
                        decayTimeout = null;
                    }
                    
                    gestureMode = 'tap';
                    tapTimes.push(now);
                    
                    // Calculate BPM from taps
                    const bpm = calculateBPMFromTaps();
                    if (bpm) {
                    const speed = bpmToSpeed(bpm);
                    setTargetSpeed(speed);
                    }
                }
            }
        }
        
        // Reset touch points
        touchPoints = [];
        
        if (touchIndicator) {
            touchIndicator.classList.remove('active');
            touchIndicator.style.background = 'rgba(255, 255, 255, 0.8)'; // Reset color
        }
        
        // Restart decay timer on touch end only for tap mode (scroll should hold its value)
        if (inputMode === 'tap') {
            startDecayToDefault();
        }
    }

    // Handle scroll events for scroll mode
    function handleScroll(event) {
        if (inputMode !== 'scroll') return;
        
        event.preventDefault();

        const now = Date.now();
        const deltaY = event.deltaY; // Positive = scroll down, Negative = scroll up
        if (deltaY === 0) return;
        
        registerScrollActivity();
        
        // Detect scroll direction
        const newDirection = deltaY > 0 ? 'down' : 'up';
        
        // If direction changed, reset scroll history to start fresh
        if (currentScrollDirection !== null && currentScrollDirection !== newDirection) {
            scrollHistory = [];
            smoothedScrollSpeed = 0; // Reset smoothed speed when direction changes
        }
        
        currentScrollDirection = newDirection;
        
        // Track cumulative scroll delta (only for same direction)
        let cumulativeDelta = deltaY;
        if (scrollHistory.length > 0) {
            cumulativeDelta = scrollHistory[scrollHistory.length - 1].cumulativeDelta + deltaY;
        }
        
        // Add scroll event to history
        scrollHistory.push({
            time: now,
            delta: deltaY,
            cumulativeDelta: cumulativeDelta
        });
        
        // Update scroll speed calculation
        if (now - lastScrollUpdateTime > SCROLL_UPDATE_INTERVAL_MS) {
            const scrollSpeed = calculateScrollSpeed();
            const playbackSpeed = scrollSpeedToPlaybackSpeed(scrollSpeed);
            
            setTargetSpeed(playbackSpeed);
            lastScrollUpdateTime = now;
            
            // Update indicator color based on direction
            if (touchIndicator) {
                if (playbackSpeed > 0) {
                    // Forward (scroll down) - blue
                    const intensity = Math.abs(playbackSpeed / 2.0);
                    const blue = Math.floor(255 * Math.max(0.4, intensity));
                    touchIndicator.style.background = `rgba(100, 100, ${blue}, 0.8)`;
                } else if (playbackSpeed < 0) {
                    // Backward (scroll up) - red
                    const intensity = Math.abs(playbackSpeed / 2.0);
                    const red = Math.floor(255 * Math.max(0.4, intensity));
                    touchIndicator.style.background = `rgba(${red}, 100, 100, 0.8)`;
                } else {
                    touchIndicator.style.background = 'rgba(255, 255, 255, 0.8)';
                }
            }
            
            // Clear decay timeout when scrolling
            if (decayTimeout) {
                clearTimeout(decayTimeout);
                decayTimeout = null;
            }
            
            lastGestureTime = now;
        }
        
        scheduleScrollDecayAfterInactivity();
    }
    //Touch control function ends here, Event Listeners below near bottom
    //Audiobook functions start here

    // Helper functions
    function setSpeedLabel(v) {
        if (speedLabel) speedLabel.textContent = `${v.toFixed(2)}x`;
    }

    // Add a separate function for the actual speed label
    function setActualSpeedLabel(v) {
        const actualSpeedLabel = document.getElementById('actual-speed-label');
        if (actualSpeedLabel) actualSpeedLabel.textContent = `${v.toFixed(2)}x`;
    }

    function clampSpeed(value) {
        const min = parseFloat(speedSlider?.min || '-4');
        const max = parseFloat(speedSlider?.max || '4');
        return Math.max(min, Math.min(max, value));
    }

    function syncSpeedTargetUI() {
        if (speedSlider) {
            speedSlider.value = speedTarget;
        }
        setSpeedLabel(speedTarget);
    }

    function setTargetSpeed(value, options = {}) {
        const { syncSlider = true } = options;
        speedTarget = clampSpeed(value);
        if (syncSlider) {
            syncSpeedTargetUI();
        }
    }

    //timestamp and progress bar
    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function updateProgress() {
        if (!audio) return;
        const progress = (audio.currentTime / audio.duration) * 100;
        if (progressBar && !isSeeking) {
            progressBar.value = progress;
            //update progress bar fill
            progressBar.style.background = `linear-gradient(to right, cornflowerblue 0%, cornflowerblue ${progress}%, #e0e0e0 ${progress}%, #e0e0e0 100%)`;
        }
        if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(audio.currentTime);
        if (durationTimeDisplay) durationTimeDisplay.textContent = formatTime(audio.duration);
    }

    //parameter labels in real-time
    function updateParameterLabels() {
        const currentSpeed = Math.abs(speedActual); // Use smoothed speed
        const isNegative = speedActual < 0;
        
        const chunkMultiplier = parseFloat(chunkSizeInput?.value || 1);
        const stepMultiplier = parseFloat(rewindStepInput?.value || 1);
        const basePeriod = parseFloat(rewindPeriod?.value || 0.5);
        const baseOverlap = parseFloat(rewindOverlap?.value || 0.3);
        const basePlaybackSpeed = parseFloat(rewindPlaybackSpeed?.value || 1);
        const baseBPM = parseFloat(baseBPMInput?.value || 60);
        
        if (isNegative && currentSpeed > 0) {
            // Calculate actual values being used during rewind (for user display)
            const actualInterval = basePeriod; // Period stays CONSTANT
            const actualStep = (basePeriod * currentSpeed) * stepMultiplier; //how far to step back in rewind
            const baseChunkDuration = actualInterval + baseOverlap;
            const actualChunkDuration = baseChunkDuration * chunkMultiplier;
            
            if (chunkSizeLabel) {
                chunkSizeLabel.textContent = `${chunkMultiplier.toFixed(2)}x (actual: ${actualChunkDuration.toFixed(2)}s)`;
            }
            if (rewindStepLabel) {
                rewindStepLabel.textContent = `${stepMultiplier.toFixed(2)}x (actual: ${actualStep.toFixed(2)}s)`;
            }
            if (rewindPeriodLabel) {
                rewindPeriodLabel.textContent = `${basePeriod.toFixed(2)}s (period: ${actualInterval.toFixed(2)}s)`;
            }
            if (rewindOverlapLabel) {
                rewindOverlapLabel.textContent = `${baseOverlap.toFixed(2)}s`;
            }
        } else {
            // Show base values when not rewinding
            if (chunkSizeLabel) {
                chunkSizeLabel.textContent = `${chunkMultiplier.toFixed(2)}x`;
            }
            if (rewindStepLabel) {
                rewindStepLabel.textContent = `${stepMultiplier.toFixed(2)}x`;
            }
            if (rewindPeriodLabel) {
                rewindPeriodLabel.textContent = `${basePeriod.toFixed(2)}s`;
            }
            if (rewindOverlapLabel) {
                rewindOverlapLabel.textContent = `${baseOverlap.toFixed(2)}s`;
            }
        }
        
        if (rewindPlaybackSpeedLabel) {
            rewindPlaybackSpeedLabel.textContent = `${basePlaybackSpeed.toFixed(2)}x`;
        }
        
        if (baseBPMLabel) {
            baseBPMLabel.textContent = `${baseBPM.toFixed(0)} BPM`;
        }
    }

    // Start leaky integrator for speed slider (Low Pass Filter)
    function startSpeedIntegrator() {
        if (speedIntegratorInterval) return; // Already running
        
        speedIntegratorInterval = setInterval(() => {
            const ALPHA = parseFloat(document.getElementById('alpha')?.value || 0.02);
            // Advance speedActual toward speedTarget
            speedActual = speedActual + ALPHA * (speedTarget - speedActual); //Low Pass Filter equation
            
            // Clamp to slider min/max
            const min = parseFloat(speedSlider?.min || -2);
            const max = parseFloat(speedSlider?.max || 4);
            speedActual = Math.min(max, Math.max(min, speedActual));
            
            // Update ONLY the actual speed label (not the target label)
            setActualSpeedLabel(speedActual);
            
            // Update integrator display slider
            updateIntegratorDisplay();
            
            if (!audio) return;
            
            //apply the smoothed speed
            if (speedActual < 0) {
                //negative speed - use rewind mode
                if (!rewindInterval && !audio.paused) {
                    startContinuousRewind(speedActual);
                } else if (rewindInterval) {
                    //already rewinding, parameters will be read from speedActual
                    updateParameterLabels();
                }
            } else {
                //positive speed - use normal playback
                const wasRewindingActive = rewindInterval !== null;
                
                if (wasRewindingActive) {
                    stopContinuousRewind();
                }
                
                //clamp playback rate to HTML5 audio supported range
                const clampedRate = Math.max(0.25, Math.min(4, speedActual));
                audio.playbackRate = clampedRate;
                
                if (wasRewindingActive && wasPlayingBeforeRewind) {
                    audio.play().catch(console.error);
                    if (playButton) playButton.textContent = 'Pause';
                }
                
                updateParameterLabels();
            }
        }, TICK_MS);
    }

    function initWebAudio() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // Tempo stretching using overlap-add technique
    function createTempoStretchedBuffer(sourceBuffer, tempoFactor) {
        if (!audioContext || !sourceBuffer || Math.abs(tempoFactor - 1.0) < 0.01) {
            return sourceBuffer;
        }
        
        const sampleRate = sourceBuffer.sampleRate;
        const numberOfChannels = sourceBuffer.numberOfChannels;
        const originalLength = sourceBuffer.length;
        const newLength = Math.floor(originalLength / tempoFactor);
        
        //buffer for audio manipulation (hopSize is original audio step for tempo change)
        const stretchedBuffer = audioContext.createBuffer(numberOfChannels, newLength, sampleRate);
        const windowSize = Math.floor(sampleRate * 0.04);
        const hopSize = Math.floor(windowSize / 2);
        const outputHopSize = Math.floor(hopSize / tempoFactor);
        
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const inputData = sourceBuffer.getChannelData(channel);
            const outputData = stretchedBuffer.getChannelData(channel);
            let inputPos = 0;
            let outputPos = 0;
            
            //windowing using Hann window
            while (inputPos + windowSize < originalLength && outputPos < newLength) {
                for (let i = 0; i < windowSize && outputPos + i < newLength; i++) {
                    const hannWindow = 0.5 * (1 - Math.cos(2 * Math.PI * i / windowSize));
                    const sample = inputData[inputPos + i] * hannWindow;
                    outputData[outputPos + i] = (outputData[outputPos + i] || 0) + sample;
                }
                inputPos += hopSize;
                outputPos += outputHopSize;
            }
            
            // Normalize to prevent clipping
            let maxAmplitude = 0;
            for (let i = 0; i < newLength; i++) {
                maxAmplitude = Math.max(maxAmplitude, Math.abs(outputData[i]));
            }
            if (maxAmplitude > 1.0) {
                for (let i = 0; i < newLength; i++) {
                    outputData[i] /= maxAmplitude;
                }
            }
        }
        
        return stretchedBuffer;
    }

    //chunking and overlapping playback
    function playOverlappingChunk(startTime, duration, overlap) {
        if (!audioContext || !audioBuffer) return;

        const tempoFactor = parseFloat(rewindPlaybackSpeed?.value || 1);
        const startSample = Math.floor(startTime * audioBuffer.sampleRate);
        const durationSamples = Math.floor(duration * audioBuffer.sampleRate);
        const actualDurationSamples = Math.min(durationSamples, audioBuffer.length - startSample);
        
        if (actualDurationSamples <= 0) return;
        
        // Create and copy chunk buffer
        const chunkBuffer = audioContext.createBuffer(
            audioBuffer.numberOfChannels,
            actualDurationSamples,
            audioBuffer.sampleRate
        );
        
        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const sourceData = audioBuffer.getChannelData(channel);
            const chunkData = chunkBuffer.getChannelData(channel);
            chunkData.set(sourceData.subarray(startSample, startSample + actualDurationSamples));
        }
        
        const stretchedBuffer = createTempoStretchedBuffer(chunkBuffer, tempoFactor);
        if (!stretchedBuffer) return;
        
        // Setup playback with crossfade
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        source.buffer = stretchedBuffer;
        source.connect(gain).connect(audioContext.destination);
        
        const now = audioContext.currentTime;
        const fadeDuration = Math.min(overlap / 2, FADE_TIME);
        const chunkDuration = stretchedBuffer.duration;
        
        // Fade in/out to prevent clicks
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(1, now + fadeDuration);
        
        const fadeOutStart = now + chunkDuration - fadeDuration;
        if (fadeOutStart > now) {
            gain.gain.setValueAtTime(1, fadeOutStart);
            gain.gain.linearRampToValueAtTime(0, now + chunkDuration);
        }
        
        source.start(now);
        source.stop(now + chunkDuration);
    }

    //rewinding functions
    function startContinuousRewind(speed) {
        stopContinuousRewind();
        //check for rewinding condition: negative speed
        if (!audio || speed >= 0) return;
        
        //pause forward playback and mark as rewinding
        wasPlayingBeforeRewind = !audio.paused;
        isRewinding = true;
        
        if (!audioContext) initWebAudio();
        if (!audio.paused) audio.pause();
        if (playButton) playButton.textContent = 'Pause';
        
        const executeRewind = () => {
            if (!audio || audio.currentTime <= 0) {
                stopContinuousRewind();
                setTargetSpeed(1.0);
                speedActual = 1.0;
                setActualSpeedLabel(speedActual);
                if (audio) audio.playbackRate = 1;
                updateParameterLabels();
                return;
            }
            
            //parameters for speedslider, period, and overlap duration
            const currentSpeed = Math.abs(speedActual); // Use smoothed speed
            const basePeriod = parseFloat(rewindPeriod?.value || 0.5);
            const overlap = parseFloat(rewindOverlap?.value || 0.3);
            const chunkMultiplier = parseFloat(chunkSizeInput?.value || 1);
            const stepMultiplier = parseFloat(rewindStepInput?.value || 1);
            
            // Calculate adjustable parameters with separate multipliers (in rewind use, back end)
            const interval = basePeriod; // Keep interval constant (period between chunks)
            const stepSize = (basePeriod * currentSpeed) * stepMultiplier; // how far to rewind each step
            const baseChunkDuration = interval + overlap;
            const chunkDuration = baseChunkDuration * chunkMultiplier; // How long audio chunk is
            
            //get start of chunk to play
            const chunkStart = Math.max(0, audio.currentTime - chunkDuration);
            
            if (audioBuffer) {
                playOverlappingChunk(chunkStart, chunkDuration, overlap);
            }
            
            audio.currentTime = Math.max(0, audio.currentTime - stepSize);
            updateParameterLabels();
            
            rewindInterval = setTimeout(executeRewind, interval * 1000);
        };
        
        executeRewind();
    }

    function stopContinuousRewind() {
        if (rewindInterval) {
            clearTimeout(rewindInterval);
            rewindInterval = null;
        }
        isRewinding = false;
        updateParameterLabels();
    }

    //file management and loading audio
    async function decodeAudioFile(arrayBuffer) {
        if (!audioContext) initWebAudio();
        try {
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        } catch (err) {
            console.error('Error decoding audio:', err);
        }
    }

    function setupAudioElement() {
        if (audio) return;
        
        audio = new Audio();
        audio.preload = 'metadata';
        
        audio.addEventListener('ended', () => {
            if (!isRewinding && playButton) playButton.textContent = 'Play';
        });
        audio.addEventListener('play', () => {
            if (!isRewinding && playButton) playButton.textContent = 'Pause';
        });
        audio.addEventListener('pause', () => {
            if (!isRewinding && playButton) playButton.textContent = 'Play';
        });
        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('loadedmetadata', () => {
            updateProgress();
            if (progressBar) progressBar.max = 100;
        });
    }

    function loadFile(file) {
        if (!file) return;
        
        if (currentAudio) {
            URL.revokeObjectURL(currentAudio);
            currentAudio = null;
        }

        setupAudioElement();
        if (audio) audio.pause();

        currentAudio = URL.createObjectURL(file);
        audio.src = currentAudio;
        audio.playbackRate = speedActual; // Use smoothed speed
        
        if (currentFile) currentFile.textContent = file.name;
        [playButton, rewindButton, fastForwardButton].forEach(btn => {
            if (btn) btn.disabled = false;
        });

        file.arrayBuffer().then(decodeAudioFile);
    }

    function loadDefaultTrack() {
        setupAudioElement();
        
        audio.src = DEFAULT_TRACK;
        audio.playbackRate = speedActual; // Use smoothed speed
        
        if (currentFile) currentFile.textContent = 'Default Track';
        [playButton, rewindButton, fastForwardButton].forEach(btn => {
            if (btn) btn.disabled = false;
        });

        fetch(DEFAULT_TRACK)
            .then(response => response.arrayBuffer())
            .then(decodeAudioFile)
            .catch(err => console.error('Error loading default track:', err));
    }

    //function to update the integrator visualization
    function updateIntegratorDisplay() {
        const actualSpeedLabel = document.getElementById('actual-speed-label');
        const actualSpeedDisplay = document.getElementById('actual-speed-display');
        
        if (actualSpeedLabel) {
            actualSpeedLabel.textContent = `${speedActual.toFixed(2)}x`;
        }
        
        if (actualSpeedDisplay) {
            actualSpeedDisplay.value = speedActual;
        }
    }

    // Event Listeners
    playButton?.addEventListener('click', () => {
        if (!audio) return;
        
        // Set speed to default when pressing play (if paused)
        if (audio.paused) {
            setTargetSpeed(1.0);
            startDecayToDefault();
        }
        
        const currentSpeed = speedTarget;
        
        if (currentSpeed < 0) {
            if (rewindInterval) {
                stopContinuousRewind();
                wasPlayingBeforeRewind = false;
                if (playButton) playButton.textContent = 'Play';
            } else {
                startContinuousRewind(currentSpeed);
                wasPlayingBeforeRewind = true;
                if (playButton) playButton.textContent = 'Pause';
            }
        } else {
            audio.paused ? audio.play().catch(console.error) : audio.pause();
        }
    });

    rewindButton?.addEventListener('click', () => {
        if (!audio) return;
        const stepMultiplier = parseFloat(rewindStepInput?.value || 1);
        audio.currentTime = Math.max(0, audio.currentTime - stepMultiplier);
    });

    fastForwardButton?.addEventListener('click', () => {
        if (!audio) return;
        audio.currentTime = Math.min(audio.duration, audio.currentTime + 1);
    });

    uploadForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (fileInput?.files?.length) loadFile(fileInput.files[0]);
    });

    fileInput?.addEventListener('change', () => {
        if (fileInput?.files?.length) loadFile(fileInput.files[0]);
    });

    speedSlider?.addEventListener('input', () => {
        const sliderValue = parseFloat(speedSlider.value || '1');
        setTargetSpeed(sliderValue);
        updateIntegratorDisplay(); // Update display slider immediately
    });

    progressBar?.addEventListener('mousedown', () => isSeeking = true);
    progressBar?.addEventListener('mouseup', () => isSeeking = false);
    progressBar?.addEventListener('input', () => {
        if (!audio) return;
        audio.currentTime = (progressBar.value / 100) * audio.duration;
        updateProgress(); // Call updateProgress directly to update time display
    });

    [chunkSizeInput, rewindStepInput, rewindPeriod, rewindOverlap, rewindPlaybackSpeed].forEach(slider => {
        slider?.addEventListener('input', updateParameterLabels);
    });

    baseBPMInput?.addEventListener('input', updateParameterLabels);

    // Function to update UI labels based on input mode
    function updateInputModeLabels() {
        if (inputMode === 'scroll') {
            if (inputModeLabel) inputModeLabel.textContent = 'Scrolling';
            if (leftZoneLabel) leftZoneLabel.textContent = 'Up to Rewind ⬆️';
            if (rightZoneLabel) rightZoneLabel.textContent = 'Down for Forward ⬇️';
        } else {
            if (inputModeLabel) inputModeLabel.textContent = 'Tapping/Circling';
            if (leftZoneLabel) leftZoneLabel.textContent = 'Circles Rewind/Forward 🔄';
            if (rightZoneLabel) rightZoneLabel.textContent = 'Taps Forward';
        }
    }

    // Toggle input mode
    if (inputModeToggle) {
        inputModeToggle.addEventListener('change', (event) => {
            inputMode = event.target.checked ? 'scroll' : 'tap';
            updateInputModeLabels();
            
            // Reset gesture state when switching modes
            touchPoints = [];
            scrollHistory = [];
            gestureMode = null;
            circleDirection = null;
            smoothedCircleSpeed = 0;
            smoothedScrollSpeed = 0;
            scrollSessionStartTime = null;
            if (scrollDecayStartTimeout) {
                clearTimeout(scrollDecayStartTimeout);
                scrollDecayStartTimeout = null;
            }
            
            // Reset speed to default when switching modes
            setTargetSpeed(DEFAULT_DECAY_SPEED);
        });
    }

    // Touchscreen control zone event listeners
    if (touchControlArea) {
        // Mouse events
        touchControlArea.addEventListener('mousedown', handleTouchStart);
        touchControlArea.addEventListener('mousemove', handleTouchMove);
        touchControlArea.addEventListener('mouseup', handleTouchEnd);
        touchControlArea.addEventListener('mouseleave', handleTouchEnd);
        
        // Touch events for mobile
        touchControlArea.addEventListener('touchstart', handleTouchStart);
        touchControlArea.addEventListener('touchmove', handleTouchMove);
        touchControlArea.addEventListener('touchend', handleTouchEnd);
        touchControlArea.addEventListener('touchcancel', handleTouchEnd);
        
        // Scroll events (wheel) for scroll mode
        touchControlArea.addEventListener('wheel', handleScroll, { passive: false });
    }


    // Initialize
    setSpeedLabel(speedTarget); // Show target value
    setActualSpeedLabel(speedActual); // Show actual value
    updateParameterLabels();
    updateInputModeLabels(); // Initialize input mode labels
    loadDefaultTrack();
    startSpeedIntegrator(); // Start the leaky integrator

    // Cleanup
    window.addEventListener('beforeunload', () => {
        if (currentAudio) URL.revokeObjectURL(currentAudio);
        if (audioContext) audioContext.close();
        if (rewindInterval) clearTimeout(rewindInterval);
        if (speedIntegratorInterval) clearInterval(speedIntegratorInterval);
    });
