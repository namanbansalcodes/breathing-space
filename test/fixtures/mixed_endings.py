"""Mixed line endings: this file must NOT be renormalized."""
import os


def f(x):
    a = 1
    if x:
        b = 2
        return b
    return a


def g(y):
    for i in range(y):
        y += i
    return y


print(os.sep, f(1), g(2))
