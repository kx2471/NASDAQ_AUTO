# autotrader/utils/timez.py
from datetime import datetime
import pytz

def kst_now() -> datetime:
    """Returns the current time in KST."""
    return datetime.now(pytz.timezone('Asia/Seoul'))

def et_now() -> datetime:
    """Returns the current time in ET."""
    return datetime.now(pytz.timezone('US/Eastern'))

def to_kst(dt: datetime) -> datetime:
    """Converts a datetime object to KST."""
    return dt.astimezone(pytz.timezone('Asia/Seoul'))

def to_et(dt: datetime) -> datetime:
    """Converts a datetime object to ET."""
    return dt.astimezone(pytz.timezone('US/Eastern'))
