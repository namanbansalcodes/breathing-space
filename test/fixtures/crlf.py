"""CRLF fixture: every terminator in this file is a carriage return + newline."""
import os


def f(x):
    """Doc."""
    a = 1
    if x:
        b = 2
        return b
    for i in range(a):
        a += i
    # a comment
    s = """
    return not_a_return
    """
    return a, s


class C:
    """Class docstring."""
    ATTR = 1
    def m(self):
        try:
            return self.ATTR
        except AttributeError:
            raise


print(os.sep, f(1), C().m())
