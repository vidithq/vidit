"""The base of every business error the API answers with a typed ``{code, message}`` body."""

from typing import ClassVar


class CodedError(Exception):
    """A business error with a stable ``code`` and the HTTP status the API answers it with.

    ``main.coded_error_handler`` turns an uncaught one into the response. The attribute is
    ``status_code``, as on ``HTTPException``, so Sentry still captures a 5xx one. A class that
    sets ``code`` per raise lists every value it sets in ``instance_codes``.
    """

    code: str
    status_code: int
    instance_codes: ClassVar[tuple[str, ...]] = ()


def declared_codes(base: type[Exception]) -> set[str]:
    """Every code ``base`` and its subclasses declare, as a class ``code`` or in
    ``instance_codes``. Complete once every module that defines a subclass is imported."""
    codes: set[str] = set()
    pending = [base]
    while pending:
        cls = pending.pop()
        pending.extend(cls.__subclasses__())
        code = cls.__dict__.get("code")
        if isinstance(code, str):
            codes.add(code)
        if issubclass(cls, CodedError):
            codes.update(cls.instance_codes)
    return codes
