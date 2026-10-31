"""Already fully spaced: every adjacent sibling pair is already separated."""

import os

import sys


def f(x):
    """Doc."""

    a = 1

    if x:

        b = 2

        return b

    for i in range(a):

        a += i

    # A comment that already has air above it.

    return a


class C:
    """Class docstring."""

    ATTR = 1

    def m(self):

        return self.ATTR


print(os.sep, sys.platform, C().m(), f(1))
