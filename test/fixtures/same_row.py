"""Same-row siblings: trailing comments and semicolon-joined statements."""


def trailing_comments(x):
    a = 1  # this comment shares a row with a = 1
    b = 2  # so does this one
    if x:  # and this one sits on the if
        return a  # and this one on the return
    return b


def semicolons(x):
    a = 1; b = 2
    c = 3; d = 4; e = 5
    if x: return a + b
    while x: x -= 1; break
    return c + d + e


def mixed(x):
    a = 1; b = 2  # semicolon pair with a trailing comment
    # a standalone comment on its own row
    for i in range(a): b += i  # compound header and body on one row
    try: c = 1
    except ValueError: c = 2
    return b + c


class Row:
    A = 1; B = 2  # class-level semicolons
    def one_liner(self): return self.A  # def and body on one row


t = 1; u = 2  # module-level semicolons
v = 3  # module-level trailing comment
