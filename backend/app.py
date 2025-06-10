from flask import Flask, request, jsonify, send_from_directory
from vision_manager import VisionManager  # Assuming VisionManager is implemented in Python
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
from dotenv import load_dotenv

import numpy as np
import os

import traceback

from functools import wraps

load_dotenv()

# Determine the port and environment
if os.getenv('NODE_ENV') == "production":
    host_port = int(os.getenv('PORT', 3000))
    print("Running as production!")
else:
    host_port = int(os.getenv('PORT', 8080))
    print("Running as development!")

# Check for SSL certificate files
cert_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'ssl', 'server.crt')
key_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'ssl', 'server.key')
ssl_context = None
if os.path.exists(cert_path) and os.path.exists(key_path):
    ssl_context = (cert_path, key_path)
    print("SSL certificates found, HTTPS enabled")
else:
    print("SSL certificates not found, running without HTTPS")

def socketio_error_handler(func):
    """Decorator to handle exceptions in SocketIO event handlers"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        session_id = request.sid
        try:
            return func(*args, **kwargs)
        except Exception as e:
            print(f'Error in {func.__name__} for session {session_id}: {e}')
            print('===ERROR ON REQUEST===')
            print(f'Error: {str(e)}')
            print(f'Traceback:\n{traceback.format_exc()}')
            print('=======================')
            emit('error', {'message': str(e)})
    return wrapper

def api_error_handler(func):
    """Decorator to handle exceptions in API route handlers"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            print(f'Error in {func.__name__}: {e}')
            print('===ERROR ON REQUEST===')
            print(f'Error: {str(e)}')
            print(f'Traceback:\n{traceback.format_exc()}')
            print('=======================')
            return jsonify(success=False, error=str(e))
    return wrapper

def create_app():
    app = Flask(__name__)
    app.config['UPLOAD_FOLDER'] = '/tmp'  # Temporary folder for file uploads
    
    socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

    global vision_manager
    vision_manager = VisionManager(socketio)
    
    # Serve static files
    @app.route('/dist/<path:path>')
    def serve_static(path):
        return send_from_directory(os.path.join(os.getcwd(), 'dist'), path)

    @app.route('/api/')
    def api():
        return jsonify(success=True, message="API is working!")
    
    @app.route('/api/set_source_image/', methods=['POST'])
    @api_error_handler
    def set_source_image():
        if 'source' not in request.files:
            return jsonify(success=False, error="No file part")
        
        # Check if the session ID is provided
        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify(success=False, error="Session ID is required")
        
        result = vision_manager.set_source_image(session_id, request.files['source'])
        return jsonify(success=True, data=result)
    
    @app.route('/api/step/', methods=['POST'])
    @api_error_handler
    def step():
        if 'image' not in request.files:
            return jsonify(success=False, error="No file part")
        
        # Check if the session ID is provided
        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify(success=False, error="Session ID is required")
        
        result = vision_manager.step(session_id, request.files['image'])
        return jsonify(success=True, data=result)
    
    @app.route('/api/explain_screen/', methods=['POST'])
    @api_error_handler
    def explain_screen():
        # Check if the session ID is provided
        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify(success=False, error="Session ID is required")

        result = vision_manager.get_current_image_description(session_id)
        return jsonify(success=True, data=result)
    
    # WebSocket event handlers
    @socketio.on('connect')
    @socketio_error_handler
    def handle_connect(auth=None):
        print(f'Client connected: {request.sid}')
        join_room(request.sid)
        vision_manager.add_connection(request.sid)
        emit('connected', {'session_id': request.sid})
    
    @socketio.on('disconnect')
    @socketio_error_handler
    def handle_disconnect(auth=None):
        print(f'Client disconnected: {request.sid}')
        vision_manager.stop_recognition(request.sid)
        vision_manager.remove_connection(request.sid)
    
    @socketio.on('start_recognition')
    @socketio_error_handler
    def handle_start_recognition():
        """Start continuous speech recognition"""
        session_id = request.sid
        print(f'Starting recognition for session {session_id}')
        vision_manager.start_recognition(session_id)
    
    @socketio.on('stop_recognition')
    @socketio_error_handler
    def handle_stop_recognition():
        """Stop continuous speech recognition"""
        session_id = request.sid
        print(f'Stopping recognition for session {session_id}')
        vision_manager.stop_recognition(session_id)
    
    @socketio.on('audio_chunk')
    @socketio_error_handler
    def handle_audio_chunk(data):
        """Handle incoming audio chunks"""
        session_id = request.sid
        print(f'Received audio chunk from {session_id}')

        # Convert base64 to bytes if needed
        if isinstance(data, str):
            import base64
            audio_data = base64.b64decode(data)
        else:
            audio_data = data
        
        vision_manager.process_audio_chunk(session_id, audio_data)
    
    return app, socketio

# Create the app instance
app, socketio = create_app()

if __name__ == '__main__':
    if ssl_context:
        socketio.run(app, host='0.0.0.0', port=host_port, ssl_context=ssl_context)
    else:
        socketio.run(app, host='0.0.0.0', port=host_port)
