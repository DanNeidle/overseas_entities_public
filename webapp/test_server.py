import http.server
import socketserver
import os
import threading

# The directory to be served
directory = "webapp"
# The port the server will run on
port = 8002

socketserver.TCPServer.allow_reuse_address = True

# --- Create a custom server class for graceful shutdown ---
class StoppableTCPServer(socketserver.TCPServer):
    """A TCPServer that can be shut down gracefully."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._shutdown_request = threading.Event()

    def serve_forever(self, poll_interval=0.5):
        """Handle requests until an explicit shutdown request."""
        while not self._shutdown_request.is_set():
            self.handle_request()

    def shutdown(self):
        """Stop the serve_forever loop."""
        self._shutdown_request.set()

# --- Main execution ---
if not os.path.exists(directory):
    print(f"Error: Directory '{directory}' not found.")
else:
    os.chdir(directory)

    Handler = http.server.SimpleHTTPRequestHandler
    httpd = None  # Initialize httpd to None

    try:
        # Create the server and specify the port
        httpd = StoppableTCPServer(("", port), Handler)
        print(f"Serving at http://localhost:{port} from directory '{directory}'")
        print("Press Ctrl+C to stop the server.")
        # Start the server
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nKeyboard interrupt received, shutting down.")
    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if httpd:
            print("Closing server...")
            httpd.server_close() # Clean up the server
            print("Server closed.")