import React from "react";

/**
 * Shared component for WatVision debug controls and status display
 */
function DebugControls({ 
    watVision,
    loading,
    error,
    isRecording,
    speechError,
    interimText,
    sessionId,
    trackingScreen,
    toggleSpeechRecognition,
    toggleTrackingScreen,
    explainScreen,
    requestStartTrackingTouchScreen
}) {
    return (
        <>
            {/* Status Display */}
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

            {/* Control Buttons */}
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

            {/* Debug Controls */}
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
        </>
    );
}

/**
 * Shared component for debug images display
 */
function DebugImages({ debugInputImageRef, debugReferenceImageRef }) {
    return (
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
    );
}

export { DebugControls, DebugImages };
