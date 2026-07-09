import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.stt import transcriber


class TestSTTDeviceDetection(unittest.TestCase):
    def test_detect_device_falls_back_to_cpu_when_torch_import_fails(self):
        real_import = __import__

        def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name == "torch":
                raise OSError("Could not load symbol cudnnGetLibConfig. Error code 127")
            return real_import(name, globals, locals, fromlist, level)

        with mock.patch("builtins.__import__", side_effect=fake_import):
            self.assertEqual(transcriber._detect_device(), "cpu")


if __name__ == "__main__":
    unittest.main()
