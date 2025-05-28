from flask import Flask, request, jsonify, send_from_directory
from vision_manager import VisionManager  # Assuming VisionManager is implemented in Python
import os
from dotenv import load_dotenv

import numpy as np
import os

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

def create_app():
    app = Flask(__name__)
    app.config['UPLOAD_FOLDER'] = '/tmp'  # Temporary folder for file uploads
    
    global vision_manager
    vision_manager = VisionManager(app)
    
    # Serve static files
    @app.route('/dist/<path:path>')
    def serve_static(path):
        return send_from_directory(os.path.join(os.getcwd(), 'dist'), path)
    
    # Helper function for try-catch
    def try_catch_result(func):
        try:
            result = func()
            return jsonify(success=True, data=result)
        except Exception as e:
            print('Error:', e)
            return jsonify(success=False, error=str(e))
    
    # API endpoint for vision processing
    @app.route('/api/get_text_info/', methods=['POST'])
    def get_text_info():
        if 'image' not in request.files:
            return jsonify(success=False, error="No file part")
        
        file = request.files['image']
        if file.filename == '':
            return jsonify(success=False, error="No selected file")
        
        return try_catch_result(lambda: vision_manager.get_text_info(file))
    
    @app.route('/api/get_homography/', methods=['POST'])
    def get_homography():
        if 'input' not in request.files or 'source' not in request.files:
            return jsonify(success=False, error="All files are not found")
        
        input_file = request.files['input']
        source_file = request.files['source']
        if input_file.filename == '' or source_file.filename == '':
            return jsonify(success=False, error="No selected files")
        
        # Save files to temporary location
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], input_file.filename)
        source_path = os.path.join(app.config['UPLOAD_FOLDER'], source_file.filename)
        input_file.save(input_path)
        source_file.save(source_path)
        return try_catch_result(lambda: vision_manager.get_homography(input_path, source_path))
    
    @app.route('/api/set_source_image/', methods=['POST'])
    def set_source_image():
        if 'source' not in request.files:
            return jsonify(success=False, error="No file part")
        
        return try_catch_result(lambda: vision_manager.set_source_image(request.files['source']))
    
    @app.route('/api/step/', methods=['POST'])
    def step():
        if 'image' not in request.files:
            return jsonify(success=False, error="No file part")
        
        return try_catch_result(lambda: vision_manager.step(request.files['image']))
    
    @app.route('/api/')
    def api():
        return jsonify(success=True, message="API is working!")
    
    return app

# Create the app instance
app = create_app()

if __name__ == '__main__':
    if ssl_context:
        app.run(host='0.0.0.0', port=host_port, ssl_context=ssl_context)
    else:
        app.run(host='0.0.0.0', port=host_port)
