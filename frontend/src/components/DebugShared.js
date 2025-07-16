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
    screenDescription,
    textElements,
    sourceImageCaptured,
    trackedElementIndex,
    toggleSpeechRecognition,
    explainScreen,
    captureScreen,
    trackElement,
    stopTrackingElement,
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
                                Voice commands: "capture screen", "start tracking", "stop tracking", "explain screen"
                            </small>
                        </div>
                    </div>
                </div>
            </div>

            {/* Control Buttons */}
            <div className="row mb-3">
                <div className="col-12">
                    <div className="d-flex flex-wrap gap-2 justify-content-center">
                        <button
                            className="btn btn-primary"
                            onClick={captureScreen}
                            disabled={!watVision}>
                            <i className="fas fa-camera"></i> Capture Screen
                        </button>
                        <button
                            className="btn btn-info"
                            onClick={explainScreen}
                            disabled={!watVision}>
                            <i className="fas fa-question-circle"></i> Explain Screen
                        </button>
                    </div>
                    {!sourceImageCaptured && (
                        <small className="text-muted d-block mt-2 text-center">
                            <i className="fas fa-info-circle"></i> Capture a screen image first before starting tracking
                        </small>
                    )}
                </div>
            </div>

            {/* Screen Info Display */}
            <div className="row mb-3">
                <div className="col-12">
                    <div className="card">
                        <div className="card-body">
                            <h5 className="card-title">Screen Information</h5>

                            {/* Screen Description */}
                            <div className="mb-3">
                                <h6>Description:</h6>
                                {screenDescription ? (
                                    <div className="alert alert-info">
                                        <small>{screenDescription}</small>
                                    </div>
                                ) : (
                                    <p className="text-muted">No screen description available. Click "Explain screen" to get one.</p>
                                )}
                            </div>

                            {/* Text Elements */}
                            <div className="mb-3">
                                <h6>Text Elements:</h6>
                                {textElements && textElements.length > 0 ? (
                                    <div className="table-responsive">
                                        <table className="table table-sm table-striped">
                                            <thead>
                                                <tr>
                                                    <th>ID</th>
                                                    <th>Text</th>
                                                    <th>Position</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {textElements.map((element, index) => (
                                                    <tr key={element.id}>
                                                        <td>{element.id}</td>
                                                        <td><strong>{element.text}</strong></td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <div style={{
                                                                position: 'relative',
                                                                width: '30px',
                                                                height: '30px',
                                                                border: '2px solid #ccc',
                                                                backgroundColor: '#f8f9fa',
                                                                borderRadius: '4px',
                                                                margin: '0 auto'
                                                            }}>
                                                                <div style={{
                                                                    position: 'absolute',
                                                                    left: `${element.position_in_bounded_text_area.norm_x * 100}%`,
                                                                    top: `${element.position_in_bounded_text_area.norm_y * 100}%`,
                                                                    width: '6px',
                                                                    height: '6px',
                                                                    backgroundColor: '#007bff',
                                                                    borderRadius: '1px',
                                                                    transform: 'translate(-50%, -50%)',
                                                                    border: '1px solid #fff'
                                                                }} title={`(${element.position_in_bounded_text_area.norm_x.toFixed(3)}, ${element.position_in_bounded_text_area.norm_y.toFixed(3)})`}>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            {trackedElementIndex === index ? (
                                                                // Currently tracking this element - show stop button
                                                                <button
                                                                    className="btn btn-sm btn-danger"
                                                                    onClick={stopTrackingElement}
                                                                    disabled={!watVision}
                                                                    title={`Stop tracking: ${element.text}`}>
                                                                    <i className="fas fa-stop"></i> Stop Tracking
                                                                </button>
                                                            ) : (
                                                                // Not tracking this element - show track button
                                                                <button
                                                                    className="btn btn-sm btn-primary"
                                                                    onClick={() => trackElement(index)}
                                                                    disabled={!watVision || !sourceImageCaptured || trackedElementIndex !== null}
                                                                    title={trackedElementIndex !== null ? 
                                                                        `Stop tracking current element first` : 
                                                                        `Track element: ${element.text}`}>
                                                                    <i className="fas fa-crosshairs"></i> Track
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="text-muted">No text elements detected. Click "Explain screen" to analyze text.</p>
                                )}
                            </div>
                        </div>
                    </div>
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
