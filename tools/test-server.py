"""Serve the built site locally during the browser tests."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os


class TestServer(ThreadingHTTPServer):
    # Browser routing disables its cache. Allow a full burst of module requests.
    request_queue_size = 128


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


if __name__ == '__main__':
    with TestServer(('127.0.0.1', int(os.environ.get('B8403_TEST_PORT', '4173'))), partial(Handler, directory='_site')) as server:
        server.serve_forever()
