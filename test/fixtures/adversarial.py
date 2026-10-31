"""Module docstring."""
import os
import sys


def strings_that_look_like_code():
    """Doc."""
    a = """
    return this is not a return
    # this is not a comment
    if this: is not an if

    def neither_is_this():
        pass
    """
    b = f"{a} # nor is this"
    c = r"""raw \n return not_a_return"""
    d = b'''bytes # return'''
    e = '''
class NotAClass:
    return nope
'''
    return a + b + c + str(d) + e


def string_holding_triple_quotes():
    s = "contains \"\"\" three quotes"
    t = "text with a trailing # hash"
    return s + t


@property
def decorated(self):
    x = 1
    return x


@staticmethod
def multi_decorated():
    y = 2
    return y


def already_spaced():
    a = 1

    if a:
        b = 2

    return a


def match_stmt(x):
    match x:
        case 1:
            y = 1
        case [1, 2, *rest]:
            y = rest
        case {"k": v}:
            y = v
        case _:
            y = 2
    return y


def nested_comprehension():
    data = [
        [y for y in range(x)]
        for x in range(10)
    ]
    seen = {k: [v for v in range(k)] for k in range(3)}
    uniq = {w for row in data for w in row}
    if (n := len(data)) > 3:
        return n
    return 0


def continuation_and_operators():
    total = 1 + \
        2 + \
        3
    parts = (
        "a"
        "b"
    )
    return total, parts


def same_row_siblings():
    a = 1  # trailing comment
    b = 2; c = 3
    d = 4; return a + b + c + d


def loops_with_else():
    for i in range(3):
        if i == 2:
            break
    else:
        i = -1
    while i > 0:
        i -= 1
        continue
    else:
        i = 0
    return i


def deeply_nested(flag):
    if flag:
        for i in range(3):
            while i:
                try:
                    with open(os.devnull) as fh:
                        if fh:
                            for j in range(2):
                                if j:
                                    raise ValueError(j)
                                i -= 1
                except ValueError:
                    i = 0
                finally:
                    flag = False
    return flag


async def async_things():
    async def inner():
        return 1
    value = await inner()
    assert value == 1
    del value
    return None


def generators_and_lambdas():
    f = lambda a, b=1, *args, **kw: a + b
    g = (n * 2 for n in range(3))
    yield f(1)
    yield from g


def typed(a: int, *args: str, b: "int" = 0, **kw: object) -> "int":
    scope = 1
    global _GLOBAL

    def closure():
        nonlocal scope
        scope += 1
        return scope
    return closure() + a + b


_GLOBAL = 0


class C:
    """Class docstring."""

    ATTR = 1
    OTHER = 2
    __slots__ = ()

    class Nested:
        """Nested class docstring."""
        VALUE = 3
        def m(self):
            return self.VALUE

    def m(self):
        try:
            a = 1
        except ValueError:
            a = 2
        finally:
            a = 3
        return a

    @property
    def p(self):
        return self.ATTR
    # trailing comment inside the class body


class Empty:
    pass


# A module-level comment introducing the block below.
if __name__ == "__main__":
    obj = C()
    for _ in range(2):
        obj.m()
    print(sys.argv, obj.p)
# A trailing comment at end of file.
