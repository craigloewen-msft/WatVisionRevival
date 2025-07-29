class SpeechStreamingClient {
    constructor(watvision_parent) {
        this.mediaRecorder = null;
        this.audioContext = null;
        this.processor = null;
        this.source = null;
        this.isRecording = false;
        this.textToSpeech = window.speechSynthesis;

        this.playbackSpeed = 2.0;

        this.isReading = false;

        this.audioTranscriptText = "";

        // Audio playback queue
        this.audioQueue = [];
        this.nextPlayTime = 0;
        this.playbackAudioContext = null;

        this.watvision_parent = watvision_parent;
    }

    async startRecording() {
        // Prevent multiple recording sessions
        if (this.isRecording) {
            console.log("Recording already in progress, skipping start recording");
            return;
        }

        try {
            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 24000,
                    sampleSize: 16
                }
            });

            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000
            });

            this.source = this.audioContext.createMediaStreamSource(stream);

            // Create script processor for raw audio access
            const bufferSize = 4096;
            this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

            // Process audio chunks
            this.processor.onaudioprocess = (e) => {
                if (!this.isRecording) return;

                const inputData = e.inputBuffer.getChannelData(0);

                // Convert float32 to int16
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    // Clamp values to 16-bit signed integer range
                    const sample = Math.max(-1, Math.min(1, inputData[i]));
                    pcmData[i] = Math.round(sample * 32767);
                }

                // Send audio chunk to backend
                const uint8Array = new Uint8Array(pcmData.buffer);
                const base64String = btoa(String.fromCharCode.apply(null, uint8Array));
                this.watvision_parent.sendWebSocketMessage('audio_chunk', {
                    audio: base64String,
                });
            };

            // Connect audio nodes
            this.source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);

            this.isRecording = true;

        } catch (error) {
            console.error('Error starting recording:', error);
            this.onError?.(error);
        }
    }

    stopRecording() {
        if (this.isRecording) {
            console.log("Stopping recording...");
            this.isRecording = false;

            // Stop media tracks first (before disconnecting source)
            if (this.source && this.source.mediaStream) {
                this.source.mediaStream.getTracks().forEach(track => track.stop());
            }

            // Disconnect audio nodes
            if (this.processor) {
                this.processor.disconnect();
                this.processor = null;
            }
            if (this.source) {
                this.source.disconnect();
                this.source = null;
            }
            if (this.audioContext) {
                this.audioContext.close();
                this.audioContext = null;
            }
        }
    }

    playAudioDelta(delta) {
        try {
            // Ensure we have a playback audio context
            if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
                this.playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 24000
                });
                // Reset timing when creating new context
                this.nextPlayTime = this.playbackAudioContext.currentTime;
            }

            // Audio comes in as base64 encoded string of pcm16 data
            const audioData = Uint8Array.from(atob(delta), c => c.charCodeAt(0));

            // Convert Uint8Array to Int16Array (PCM16 format)
            const pcm16Data = new Int16Array(audioData.buffer);

            // Create AudioBuffer manually for raw PCM data
            const audioBuffer = this.playbackAudioContext.createBuffer(
                1, // mono channel
                pcm16Data.length,
                24000 // sample rate
            );

            // Convert PCM16 to float32 and copy to AudioBuffer
            const channelData = audioBuffer.getChannelData(0);
            for (let i = 0; i < pcm16Data.length; i++) {
                channelData[i] = pcm16Data[i] / 32768.0; // Convert to float32 range [-1, 1]
            }

            // Calculate duration of this audio chunk accounting for playback rate
            const baseDuration = audioBuffer.duration;
            const actualDuration = baseDuration / this.playbackSpeed;

            // Ensure nextPlayTime is not in the past
            const currentTime = this.playbackAudioContext.currentTime;
            if (this.nextPlayTime < currentTime) {
                this.nextPlayTime = currentTime;
            }

            // Create and schedule the audio source
            const source = this.playbackAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.playbackRate.value = this.playbackSpeed
            source.connect(this.playbackAudioContext.destination);

            // Schedule playback at the next available time
            source.start(this.nextPlayTime);

            // Update nextPlayTime for the next audio chunk using actual duration
            this.nextPlayTime += actualDuration;

        } catch (error) {
            console.error('Error playing audio delta:', error);
        }
    }

    // Method to convert text to speech
    readTextAloud(text) {
        if (!this.textToSpeech || this.isReading) return;

        this.isReading = true;

        // Cancel any ongoing speech
        this.textToSpeech.cancel();

        // Create a new speech synthesis utterance
        const utterance = new SpeechSynthesisUtterance(text);

        // Configure voice settings (optional)
        utterance.rate = 1.0; // Speed: 0.1 to 10
        utterance.pitch = 1.0; // Pitch: 0 to 2
        utterance.volume = 1.0; // Volume: 0 to 1

        // Handle events
        utterance.onend = () => {
            this.isReading = false;
        };

        utterance.onerror = (event) => {
            console.error("Speech synthesis error:", event);
            this.isReading = false;
        };

        // Speak the text
        this.textToSpeech.speak(utterance);
    }

    playProximityChirp(coordinateData) {
        try {
            // Ensure we have a playback audio context
            if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
                this.playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 24000
                });
            }

            // Resume audio context if it's suspended (browser requirement)
            if (this.playbackAudioContext.state === 'suspended') {
                this.playbackAudioContext.resume();
            }

            // Handle both old format (distance as number) and new format (object with coordinates)
            let distance, direction;
            // New format with coordinates
            const dx = coordinateData.target_x - coordinateData.finger_x;
            const dy = coordinateData.target_y - coordinateData.finger_y;

            // Calculate distance
            distance = Math.sqrt(dx * dx + dy * dy);

            // Determine direction based on relative position
            // finger is to the top-right if dx > 0 and dy > 0 (target is down-right from finger)
            // finger is to the top-left if dx < 0 and dy > 0 (target is down-left from finger)  
            // finger is to the bottom-left if dx < 0 and dy < 0 (target is up-left from finger)
            // finger is to the bottom-right if dx > 0 and dy < 0 (target is up-right from finger)
            if (dx > 0 && dy > 0) {
                direction = "top-right";  // finger is top-right of target, target is down-right
            } else if (dx < 0 && dy > 0) {
                direction = "top-left";   // finger is top-left of target, target is down-left
            } else if (dx < 0 && dy < 0) {
                direction = "bottom-left";  // finger is bottom-left of target, target is up-left
            } else {  // dx > 0 && dy < 0
                direction = "bottom-right"; // finger is bottom-right of target, target is up-right
            }

            if (!distance || isNaN(distance)) {
                console.warn("Invalid distance for proximity chirp:", distance);
                return;
            }

            // Base frequency calculation - closer = higher pitch, farther = lower pitch
            const maxDistance = 200;
            const baseMaxFreq = 2000; // Base peak frequency at distance 0
            const baseMinFreq = 200;   // Base frequency at far distances

            // Clamp distance to reasonable range
            const clampedDistance = Math.min(Math.max(distance, 0), maxDistance);

            const sigma = 60;
            const gaussianFactor = Math.exp(-(clampedDistance * clampedDistance) / (2 * sigma * sigma));

            // Calculate base frequency with Gaussian relationship
            const baseFrequency = baseMinFreq + (baseMaxFreq - baseMinFreq) * gaussianFactor;

            // Define directional chirp characteristics with more distinct sounds
            const directionalChirps = {
                'top-right': {
                    // Two quick ascending beeps - high pitched
                    frequencies: [baseFrequency * 1.5, baseFrequency * 2.0],
                    durations: [0.08, 0.08],
                    gains: [0.2, 0.15],
                    waveTypes: ['sine', 'sine'],
                    gaps: [0.02] // Small gap between tones
                },
                'top-left': {
                    // Three quick descending chirps - medium-high pitched
                    frequencies: [baseFrequency * 1.4, baseFrequency * 1.1, baseFrequency * 0.8],
                    durations: [0.06, 0.06, 0.06],
                    gains: [0.18, 0.15, 0.12],
                    waveTypes: ['triangle', 'triangle', 'triangle'],
                    gaps: [0.01, 0.01]
                },
                'bottom-left': {
                    // Single long low warble - sawtooth wave
                    frequencies: [baseFrequency * 0.6],
                    durations: [0.15],
                    gains: [0.25],
                    waveTypes: ['sawtooth'],
                    gaps: []
                },
                'bottom-right': {
                    // Two-tone ascending pattern with square wave - distinctive electronic sound
                    frequencies: [baseFrequency * 0.5, baseFrequency * 1.0],
                    durations: [0.12, 0.12],
                    gains: [0.15, 0.15],
                    waveTypes: ['square', 'square'],
                    gaps: [0.03]
                },
                'center': {
                    // Single smooth tone for backward compatibility
                    frequencies: [baseFrequency],
                    durations: [0.1],
                    gains: [0.15],
                    waveTypes: ['sine'],
                    gaps: []
                }
            };

            const chirpConfig = directionalChirps[direction] || directionalChirps['center'];

            console.log(`Playing proximity chirp: distance=${distance.toFixed(2)}px, direction=${direction}, frequencies=${chirpConfig.frequencies}`);

            // Play the sequence of tones
            let startTime = this.playbackAudioContext.currentTime;

            chirpConfig.frequencies.forEach((frequency, index) => {
                const oscillator = this.playbackAudioContext.createOscillator();
                const gainNode = this.playbackAudioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(this.playbackAudioContext.destination);

                oscillator.frequency.setValueAtTime(frequency, startTime);
                oscillator.type = chirpConfig.waveTypes[index] || 'sine';

                const duration = chirpConfig.durations[index];
                const gain = chirpConfig.gains[index];

                // Envelope for smooth attack and decay
                gainNode.gain.setValueAtTime(0, startTime);
                gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

                oscillator.start(startTime);
                oscillator.stop(startTime + duration);

                // Next tone starts after this one plus any gap
                const gap = chirpConfig.gaps[index] || 0;
                startTime += duration + gap;
            });

        } catch (error) {
            console.error('Error playing proximity chirp:', error);
        }
    }
}

export default SpeechStreamingClient;