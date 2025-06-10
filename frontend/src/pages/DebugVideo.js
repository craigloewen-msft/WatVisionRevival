import React, { useEffect, useRef, useState, useMemo } from "react";
import WatVision from "../js/watvision";

function DebugVideo() {
    const videoRef = useRef(null);
    const videoCanvas = useRef(null);
    const debugInputImageRef = useRef(null);
    const debugReferenceImageRef = useRef(null);

    const watVision = useMemo(() => new WatVision(), []);

    const [videoLoaded, setVideoLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isSourceCaptured, setIsSourceCaptured] = useState(false);
    const [processingActive, setProcessingActive] = useState(false);
    const processingRef = useRef(false); // Use a ref to track processing state across renders

    // Speech recognition states
    const [isRecording, setIsRecording] = useState(false);
    const [interimText, setInterimText] = useState("");
    const [speechError, setSpeechError] = useState(null);

    const [sessionId, setSessionId] = useState(null);

    // Initialize speech client
    useEffect(() => {
        // Set up event handlers
        watVision.speechClient.setOnConnected((sessionId) => {
            console.log("Connected to speech client with session ID:", sessionId);
            setSessionId(sessionId);
            setSpeechError(null);
        });

        watVision.speechClient.setOnDisconnect(() => {
            console.log("Disconnected from speech client");
            setSessionId(null);
            setIsRecording(false);
            setSpeechError("Disconnected from speech client");
        });

        watVision.speechClient.setOnError((error) => {
            console.error("Speech recognition error:", error);
            setSpeechError(error.message || "Speech recognition error");
            setIsRecording(false);
        });

        watVision.speechClient.setOnSessionStarted(() => {
            console.log("Speech recognition session started");
            setSpeechError(null);
        });

        watVision.speechClient.setOnSessionStopped(() => {
            console.log("Speech recognition session stopped");
            setSessionId(null);
        });

        watVision.speechClient.setOnAudioTranscriptDelta((delta) => {
            setInterimText(watVision.speechClient.audioTranscriptText);
        });

        // Connect to backend
        watVision.speechClient.connect();

        // Cleanup on unmount
        return () => {
            watVision.speechClient.disconnect();
        };
    }, [watVision]);

    // Toggle speech recognition
    const toggleSpeechRecognition = async () => {
        if (!isRecording) {
            try {
                await watVision.speechClient.startSesssion();
                setIsRecording(true);
                setSpeechError(null);
            } catch (err) {
                console.error("Failed to start recording:", err);
                setSpeechError("Failed to start recording");
            }
        } else {
            watVision.speechClient.stopSession();
            setIsRecording(false);
        }
    };

    // Handle video loading
    useEffect(() => {
        const videoEl = videoRef.current;
        if (!videoEl) return;

        const handleLoadedData = () => {
            console.log("Video data loaded");
            setVideoLoaded(true);
        };

        videoEl.addEventListener("loadeddata", handleLoadedData);
        return () => {
            videoEl.removeEventListener("loadeddata", handleLoadedData);
        };
    }, []);

    // Capture initial source image when "Capture Source" button is clicked
    const captureSource = async () => {
        if (!watVision || !videoLoaded) return;

        const videoEl = videoRef.current;
        const videoCanvasEl = videoCanvas.current;

        try {
            // Ensure video is loaded and ready
            if (videoEl.readyState < 2) {
                console.warn("Video not ready yet");
                return;
            }

            // Draw the current video frame to canvas
            videoCanvasEl.width = videoEl.videoWidth;
            videoCanvasEl.height = videoEl.videoHeight;
            const ctx = videoCanvasEl.getContext("2d");
            ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);

            // Capture this frame as the source image
            await watVision.captureSourceImage(videoCanvasEl);
            setIsSourceCaptured(true);
            console.log("Source image captured successfully");
        } catch (err) {
            console.error("Error capturing source image:", err);
            setError(err);
        }
    };

    const explainScreen = async () => {
        if (!watVision) return;

        await watVision.explainScreen();
    }

    // Toggle video processing on/off
    const toggleProcessing = () => {
        setProcessingActive(prev => !prev);
    };

    // Process video frames
    useEffect(() => {
        if (!watVision || !videoLoaded || !isSourceCaptured || !processingActive) {
            return;
        }

        const videoEl = videoRef.current;
        const videoCanvasEl = videoCanvas.current;
        if (!videoEl || !videoCanvasEl) return;

        let animationFrameId;

        const processFrame = async () => {
            // Skip if we're already processing a frame or video has ended
            if (processingRef.current || videoEl.ended || videoEl.paused) {
                animationFrameId = requestAnimationFrame(processFrame);
                return;
            }

            processingRef.current = true;

            try {
                // Make sure the video has enough data
                if (videoEl.readyState < 2) {
                    processingRef.current = false;
                    animationFrameId = requestAnimationFrame(processFrame);
                    return;
                }

                // Draw the current video frame to canvas
                videoCanvasEl.width = videoEl.videoWidth;
                videoCanvasEl.height = videoEl.videoHeight;
                const ctx = videoCanvasEl.getContext("2d", { willReadFrequently: true });
                ctx.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);

                // Process this frame with WatVision
                await watVision.step(
                    videoCanvasEl,
                    debugInputImageRef.current,
                    debugReferenceImageRef.current
                );

                setLoading(false);
            } catch (err) {
                console.error("Error processing frame:", err);
                setError(err);
            } finally {
                processingRef.current = false;
                animationFrameId = requestAnimationFrame(processFrame);
            }
        };

        // Start the frame processing loop
        animationFrameId = requestAnimationFrame(processFrame);

        // Cleanup function
        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [watVision, videoLoaded, isSourceCaptured, processingActive]);

    return (
        <div className="container">
            <h3>Video Debug Page</h3>
            <div className="row">
                <div>
                    {loading ? (
                        <p>Loading...</p>
                    ) : error ? (
                        <p>Error: {error.message}</p>
                    ) : null}
                </div>
            </div>
            {/* Speech Recognition Status */}
            <div className="row mb-3">
                <div className="col-12">
                    <div className="card">
                        <div className="card-body">
                            <h5 className="card-title">Voice Control</h5>
                            <button
                                className={`btn ${isRecording ? 'btn-danger' : 'btn-primary'} mb-2`}
                                onClick={toggleSpeechRecognition}>
                                <i className={`fas fa-microphone${isRecording ? '-slash' : ''}`}></i>
                                {isRecording ? ' Stop Listening' : ' Start Listening'}
                            </button>
                            {speechError && (
                                <div className="alert alert-danger mt-2" role="alert">
                                    {speechError}
                                </div>
                            )}
                            {interimText && (
                                <div className="text-muted">
                                    <small>Listening: {interimText}</small>
                                </div>
                            )}
                            {sessionId && (
                                <div className="text-info">
                                    <small>Session ID: {sessionId}</small>
                                </div>
                            )}
                            <small className="text-muted d-block mt-2">
                                Voice commands: "capture source", "start processing", "stop processing", "explain screen"
                            </small>
                        </div>
                    </div>
                </div>
            </div>
            <div className="row mb-3">
                <div className="col-12">
                    <button
                        className="btn btn-primary mr-2"
                        onClick={captureSource}
                        disabled={!watVision || !videoLoaded || isSourceCaptured}>
                        Capture Source Frame
                    </button>
                    <button
                        className={`btn ${processingActive ? 'btn-danger' : 'btn-success'} ml-2`}
                        onClick={toggleProcessing}
                        disabled={!isSourceCaptured}>
                        {processingActive ? 'Stop Processing' : 'Start Processing'}
                    </button>
                    <button
                        className="btn btn-info ml-2"
                        onClick={explainScreen}>
                        Explain screen
                    </button>
                </div>
            </div>
            <div className="row">
                <div className="col-6">
                    <h3>Input Video</h3>
                    <video
                        ref={videoRef}
                        src="/input.mp4"
                        className="img-fluid"
                        controls
                        muted
                        style={{ maxWidth: "100%" }}
                    />
                </div>
                <div className="col-6">
                    <h3>Video Canvas</h3>
                    <canvas ref={videoCanvas} className="img-fluid" />
                </div>
            </div>
            <div className="row">
                <div className="col-6">
                    <h3>Debug Input Image</h3>
                    <img ref={debugInputImageRef} className="img-fluid" alt="Input with processing" />
                </div>
                <div className="col-6">
                    <h3>Debug Source Image</h3>
                    <img ref={debugReferenceImageRef} className="img-fluid" alt="Source reference" />
                </div>
            </div>
        </div>
    );
}

export default DebugVideo;
