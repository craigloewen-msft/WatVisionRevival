import React, { useEffect, useRef, useState } from "react";
import WatVision from "../js/watvision";

function DebugCamera() {
    const videoRef = useRef(null);
    const videoCanvas = useRef(null);
    const debugInputImageRef = useRef(null);
    const debugReferenceImageRef = useRef(null);

    const [watVision, setWatVision] = useState(null);

    const [videoLoaded, setVideoLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [trackingScreen, setTrackingScreen] = useState(false);
    const processingRef = useRef(false); // Use a ref to track processing state across renders

    // Speech recognition states
    const [isRecording, setIsRecording] = useState(false);
    const [interimText, setInterimText] = useState("");
    const [speechError, setSpeechError] = useState(null);

    const [sessionId, setSessionId] = useState(null);

    // Initialize WatVision after refs are available
    useEffect(() => {
        if (videoCanvas.current && debugInputImageRef.current && debugReferenceImageRef.current) {
            console.log("Creating WatVision instance...");

            const watVisionInstance = new WatVision(
                videoCanvas.current,
                debugInputImageRef.current,
                debugReferenceImageRef.current
            );

            // Set up event handlers
            watVisionInstance.setOnConnected((sessionId) => {
                setSessionId(sessionId);
                setSpeechError(null);
            });

            watVisionInstance.setOnDisconnect(() => {
                console.log("Disconnected from speech client");
                setSessionId(null);
                setIsRecording(false);
                setSpeechError("Disconnected from speech client");
            });

            watVisionInstance.setOnError((error) => {
                console.error("Speech recognition error:", error);
                setSpeechError(error.message || "Speech recognition error");
                setIsRecording(false);
            });

            watVisionInstance.setOnSessionStarted(() => {
                console.log("Speech recognition session started");
                setSpeechError(null);
            });

            watVisionInstance.setOnSessionStopped(() => {
                console.log("Speech recognition session stopped");
                setSessionId(null);
            });

            watVisionInstance.setOnAudioTranscriptDelta((delta) => {
                setInterimText(watVisionInstance.audioTranscriptText);
            });

            watVisionInstance.externalTrackingScreen = setTrackingScreen;

            watVisionInstance.connect();

            setWatVision(watVisionInstance);

            console.log("WatVision instance created with refs:", {
                videoCanvas: videoCanvas.current,
                debugInputImageRef: debugInputImageRef.current,
                debugReferenceImageRef: debugReferenceImageRef.current
            });

            // Cleanup on unmount
            return () => {
                console.log("Cleaning up WatVision instance...");
                watVisionInstance.disconnect();
            };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty dependency array means this runs once after initial render

    // Toggle speech recognition
    const toggleSpeechRecognition = async () => {
        if (!watVision) return;

        if (!isRecording) {
            try {
                await watVision.startSession();
                setIsRecording(true);
                setSpeechError(null);
            } catch (err) {
                console.error("Failed to start recording:", err);
                setSpeechError("Failed to start recording");
            }
        } else {
            if (watVision) {
                watVision.stopSession();
            }
            setIsRecording(false);
        }
    };

    const explainScreen = async () => {
        if (!watVision) return;

        await watVision.explainScreen();
    }

    // Toggle video processing on/off
    const toggleTrackingScreen = () => {
        if (!watVision) return;

        setTrackingScreen(prev => !prev);
        if (!trackingScreen) {
            watVision.startTrackingScreen();
        } else {
            watVision.stopTrackingScreen();
        }
    };

    // Request webcam access and set the video element's source
    useEffect(() => {
        async function setupWebcam() {
            try {
                if (!navigator.mediaDevices) {
                    throw new Error("Media Devices API not supported in this browser or requires HTTPS/localhost context");
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: "environment",
                    }
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            } catch (err) {
                console.error("Error accessing webcam: ", err);
                setError(err);
            }
        }
        setupWebcam();
    }, []);

    // Detect when video metadata is loaded (dimensions etc.)
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

    // Process video frames
    useEffect(() => {
        if (!watVision || !videoLoaded) {
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
                await watVision.step();

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
    }, [watVision, videoLoaded, trackingScreen]);

    // Debug functions

    const requestStartTrackingTouchScreen = () => {
        if (!watVision) return;
        console.log("Requesting start tracking touch screen...");
        watVision.sendWebSocketMessage('debug_request_start_tracking_touchscreen');
    };

    return (
        <div className="container">
            <h3>Debug Camera</h3>
            <div className="row">
                <div>
                    {!watVision ? (
                        <p>Initializing WatVision...</p>
                    ) : loading ? (
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
                                onClick={toggleSpeechRecognition}
                                disabled={!watVision}>
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
                        className={`btn ${trackingScreen ? 'btn-danger' : 'btn-success'} ml-2`}
                        onClick={toggleTrackingScreen}
                        disabled={!watVision}>
                        {trackingScreen ? 'Stop Tracking screen' : 'Start Tracking screen'}
                    </button>
                    <button
                        className="btn btn-info ml-2"
                        onClick={explainScreen}
                        disabled={!watVision}>
                        Explain screen
                    </button>
                </div>
            </div>
            <div className="row mb-3">
                <div className="col-12">
                    <button
                        className="btn btn-info ml-2"
                        onClick={requestStartTrackingTouchScreen}
                        disabled={!watVision}>
                        Debug: Request start tracking touch screen
                    </button>
                </div>
            </div>
            <div className="row">
                <div className="col-6">
                    <h3>Webcam Input</h3>
                    <video
                        ref={videoRef}
                        className="img-fluid"
                        muted
                        autoPlay
                        playsInline
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

export default DebugCamera;
