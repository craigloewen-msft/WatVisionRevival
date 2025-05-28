#!/usr/bin/env python3
"""
Helper script to run the Flask application with SSL.
This is useful when you want to run the app directly without the Flask CLI.
"""

import os
from backend.app import app, ssl_context, host_port

if __name__ == '__main__':
    if ssl_context:
        print(f"Running with SSL on port {host_port}")
        app.run(host='0.0.0.0', port=host_port, ssl_context=ssl_context, debug=True)
    else:
        print(f"SSL certificates not found, running without HTTPS on port {host_port}")
        app.run(host='0.0.0.0', port=host_port, debug=True)
