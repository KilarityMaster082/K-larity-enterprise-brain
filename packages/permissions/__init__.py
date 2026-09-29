# Owner task: EB-22 OpenFGA authorization model and tuple sync
"""K!larity permissions package: fine-grained OpenFGA relationship authorization."""

from .client import PermissionsClient
from .sync import TupleSynchronizer

__all__ = [
    "PermissionsClient",
    "TupleSynchronizer",
]
