import React, { useEffect, useRef, useState } from "react";
import WatVision from "../js/watvision";

function DebugVideo() {
    // videoRef replaces imageRef for the dynamic video input.
    const videoRef = useRef(null);
    // compareRef will hold the captured reference image from the first frame.
    const videoCanvas = useRef(null);
    const debugInputImageRef = useRef(null);
    const debugReferenceImageRef = useRef(null);

    const [watVision, setWatVision] = useState(null);
    const [videoLoaded, setVideoLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const videoEl = videoRef.current;

        const handleLoadedData = () => {
            setVideoLoaded(true);
        };

        videoEl.addEventListener("loadeddata", handleLoadedData);
        return () => {
            videoEl.removeEventListener("loadeddata", handleLoadedData);
        };
    });

    useEffect(() => {
        async function initWatVision() {
            let vision = new WatVision();
            await vision.init();
            setWatVision(vision);
        }
        initWatVision();
    }, []);

    useEffect(() => {
        if (!watVision || !videoLoaded) {
            console.log("Vision not ready yet");
            return;
        }
        const videoEl = videoRef.current;
        const videoCanvasEl = videoCanvas.current;
        if (!videoEl) return;

        // When video data is loaded, capture the first frame.
        const handleLoadedData = async () => {
            // Pause the video so that we capture its first frame.
            videoEl.pause();

            // Start playing the video.
            videoEl.play();

            // Process each video frame.
            const processFrame = async () => {
                if (videoEl.paused || videoEl.ended) return;
                try {

                    // Draw the video frame onto the video canvas.
                    videoCanvasEl.width = videoEl.videoWidth;
                    videoCanvasEl.height = videoEl.videoHeight;
                    const videoCanvasContext = videoCanvasEl.getContext("2d");
                    videoCanvasContext.drawImage(videoEl, 0, 0, videoEl.videoWidth, videoEl.videoHeight);

                    // Use the captured first frame as the source reference in watVision.
                    if (!watVision.doesSourceImageExist()) {
                        try {
                            await watVision.captureSourceImage(videoCanvasEl);
                        } catch (err) {
                            console.error(err);
                            setError(err);
                        }
                    }

                    // Here, we pass the video element (which drawImage accepts)
                    // along with the two debug canvases.
                    watVision.step(
                        videoCanvasEl,
                        debugInputImageRef.current,
                        debugReferenceImageRef.current
                    );
                } catch (err) {
                    console.error(err);
                    setError(err);
                }
                requestAnimationFrame(processFrame);
            };

            processFrame();
            setLoading(false);
        };

        handleLoadedData();

    }, [watVision, videoLoaded]);

    return (
        <div className="container">
            <h3>Debug page</h3>
            <div className="row">
                <div>
                    {loading ? (
                        <p>Loading...</p>
                    ) : error ? (
                        <p>Error: {error.message}</p>
                    ) : null}
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
                    <canvas className="img-fluid" ref={debugInputImageRef} />
                </div>
                <div className="col-6">
                    <h3>Debug Source Image</h3>
                    <canvas className="img-fluid" ref={debugReferenceImageRef} />
                </div>
            </div>
        </div>
    );
}

export default DebugVideo;
