Linked sections
===============

See `Project Fundamentals`_ and `reStructuredText`_, the `Python home <https://www.python.org>`_
and Python_ again. Elements like `\<document>`_ keep their names.

Project Fundamentals
--------------------

Section text with :literal:`.. \ ` inside a role and a _`footnote label`.

_destination
------------

Referenced as `_destination`_.

`reStructuredText <https://docutils.sourceforge.io/rst.html>`_:
  Defines a name reused by reStructuredText_ later on.

.. _Python: https://www.python.org

.. _<document>:

<document>
----------

The root element.

Options
-------

Palatino
  +1  recommended by font experts
  -1  bad rendering in some viewers

:latex_preamble_: Load the standard fonts::

    \usepackage{mathptmx} % Times

.. default-role:: math

A formula `\acute{x}` in the default role.
