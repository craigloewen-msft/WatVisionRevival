from flask import Flask, request, jsonify, send_from_directory
from vision_manager import VisionManager  # Assuming VisionManager is implemented in Python
import os
from dotenv import load_dotenv

import numpy as np
import os

load_dotenv()

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = '/tmp'  # Temporary folder for file uploads

vision_manager = VisionManager(app)

# Serve static files
@app.route('/dist/<path:path>')
def serve_static(path):
    return send_from_directory(os.path.join(os.getcwd(), 'dist'), path)

# Determine the port and environment
if os.getenv('NODE_ENV') == "production":
    host_port = int(os.getenv('PORT', 3000))
    print("Running as production!")
else:
    host_port = int(os.getenv('PORT', 8080))
    print("Running as development!")

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

if __name__ == '__main__':
    app.run(port=host_port)
