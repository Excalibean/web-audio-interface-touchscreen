
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
    const progressBar = document.getElementById('progress-bar');
    const currentTimeDisplay = document.getElementById('current-time');
    const durationTimeDisplay = document.getElementById('duration-time');
    
    // Touchscreen control elements
    const touchControlArea = document.getElementById('touch-control-area');
    const touchIndicator = document.getElementById('touch-indicator');


    let audio = null;
    let currentAudio = null;
    let audioContext = null;
    let rewindInterval = null;
    let audioBuffer = null;
    let isSeeking = false;
    let isRewinding = false;
    let wasPlayingBeforeRewind = false;
    let isTouching = false; // Track if user is touching the control zone
    
    const FADE_TIME = 0.04;
    const DEFAULT_TRACK = 'default_audiobook.mp3';

    // leaky integrator parameters for speed slider
    const TICK_MS = 50; // Update every 50ms
    const ALPHA = 0.15; // Convergence rate (0-1, higher = faster response)
    let speedTarget = 1.0; // Target speed from slider
    let speedActual = 1.0; // Actual speed (smoothed)
    let speedIntegratorInterval = null;

    // Touchscreen control function (touch only maybe???, mouse works like touch control anyway)
    function handleTouchControl(event) {
        event.preventDefault();
        const rect = touchControlArea.getBoundingClientRect();
        const x = (event.type.includes('touch') ? event.touches[0].clientX : event.clientX) - rect.left;
        const y = (event.type.includes('touch') ? event.touches[0].clientY : event.clientY) - rect.top;
        
        // Calculate position as percentage (0 to 1)
        const position = x / rect.width;
        
        // Map position to speed range (-2 to 2)
        const minSpeed = -2.0;
        const maxSpeed = 2.0;
        const newSpeed = minSpeed + (position * (maxSpeed - minSpeed));
        
        // Update speed target
        speedTarget = Math.max(minSpeed, Math.min(maxSpeed, newSpeed));
        
        // Update slider to match
        if (speedSlider) {
            speedSlider.value = speedTarget;
        }
        
        // Update labels
        setSpeedLabel(speedTarget);
        
        // Update touch indicator position
        if (touchIndicator) {
            touchIndicator.classList.add('active');
            touchIndicator.style.left = `${x - 30}px`; // Center the indicator (30px = half width)
            touchIndicator.style.top = `${y - 30}px`; // Center the indicator (30px = half height)
        }
    }

    function handleTouchStart(event) {
        isTouching = true;
        handleTouchControl(event);
    }

    function handleTouchMove(event) {
        if (isTouching) {
            handleTouchControl(event);
        }
    }

    function handleTouchEnd(event) {
        isTouching = false;
        if (touchIndicator) {
            touchIndicator.classList.remove('active');
        }
    }
    //Touch control function ends here, Event Listeners below near bottom

    // Helper functions
    function setSpeedLabel(v) {
        if (speedLabel) speedLabel.textContent = `${v.toFixed(2)}x`;
    }

    // Add a separate function for the actual speed label
    function setActualSpeedLabel(v) {
        const actualSpeedLabel = document.getElementById('actual-speed-label');
        if (actualSpeedLabel) actualSpeedLabel.textContent = `${v.toFixed(2)}x`;
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
    }

    // Start leaky integrator for speed slider
    function startSpeedIntegrator() {
        if (speedIntegratorInterval) return; // Already running
        
        speedIntegratorInterval = setInterval(() => {
            // Advance speedActual toward speedTarget
            speedActual = speedActual + ALPHA * (speedTarget - speedActual);
            
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
                if (speedSlider) {
                    speedSlider.value = '1';
                    speedTarget = 1.0;
                    speedActual = 1.0;
                    setSpeedLabel(1);
                    if (audio) audio.playbackRate = 1;
                }
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
        
        const currentSpeed = speedActual; // Use smoothed speed
        
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
        speedTarget = parseFloat(speedSlider.value || '1');
        setSpeedLabel(speedTarget); // Update target label immediately
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
    }


    // Initialize
    setSpeedLabel(speedTarget); // Show target value
    setActualSpeedLabel(speedActual); // Show actual value
    updateParameterLabels();
    loadDefaultTrack();
    startSpeedIntegrator(); // Start the leaky integrator

    // Cleanup
    window.addEventListener('beforeunload', () => {
        if (currentAudio) URL.revokeObjectURL(currentAudio);
        if (audioContext) audioContext.close();
        if (rewindInterval) clearTimeout(rewindInterval);
        if (speedIntegratorInterval) clearInterval(speedIntegratorInterval);
    });
