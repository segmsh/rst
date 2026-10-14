:Author: Jane Doe
:Version: 1.0

.. _top:

==================
 Project Handbook
==================

.. contents:: Table of Contents
   :depth: 2

Introduction
============

Welcome to the **handbook**. It covers *everything*, from ``pip install`` to
deployment. See :ref:`the setup guide <setup>` or :ref:`setup` for details, read
:doc:`/usage` and the :doc:`reference <api/index>`, call :func:`main` and press
:guilabel:`&Cancel`. A :term:`build` is described in the :abbr:`FAQ (frequently
asked questions)`. Visit `Python <https://www.python.org>`_, the Sphinx_ site,
`the docs`_ or an `anonymous link <https://example.com>`__ and |project| [#note]_
[1]_ [CIT2002]_. Plain URLs like https://example.com/a_b stay as they are, and
escaped \*stars\* are text.

A. Lincoln was a president,
so this is not a list.

Getting started
---------------

Install the package::

    pip install handbook

Then run it ::

    handbook --help

::

    $ handbook serve

Quoted literal block:

::

> Quoted text keeps
> its markers.

Lists
-----

- First bullet with **bold** text.
- Second bullet that is wrapped
  over two lines.

  - Nested bullet.

* Star bullet.

1. First step.
2. Second step.

#. Auto numbered.
#. Another one.

(a) Parenthesized item.

Terms
-----

Term one
   Definition of the first term.

Term two : classifier
   Definition of the second term.

   Second paragraph of the definition.

-a            Output all.
--verbose     Print more details.
-o FILE       Write output to FILE.

| A line block
| keeps its line breaks.
|     Even indented ones.

    This is a block quote with *emphasis*.

    -- Attribution text

>>> print("doctest")
doctest

Directives
----------

.. note:: This note starts on the first line
   and continues here.

.. warning::

   A warning with a blank line first.

.. admonition:: Custom title

   Admonition body text.

.. code-block:: python
   :caption: Example caption
   :linenos:

   def main():
       print("Not translated")

.. image:: images/logo.png
   :alt: The project logo
   :width: 200

.. figure:: images/diagram.png
   :alt: Architecture diagram

   The figure caption.

   The figure legend.

.. toctree::
   :maxdepth: 2
   :caption: Contents

   intro
   Usage guide <usage>
   api/index

.. versionadded:: 2.0
   The handbook gained a new chapter.

.. math::

   E = mc^2

.. py:function:: connect(host, port)

   Connect to a server.

   :param host: The host name to connect to,
       given as a string.
   :returns: A connection object.

.. unknown-directive:: argument

   Content of an unknown directive.

.. |project| replace:: The Handbook Project

.. [#note] A footnote with **bold** text.

.. [1] A numbered footnote.

.. [CIT2002] A citation.

.. _Sphinx: https://www.sphinx-doc.org

.. _the docs: https://docs.example.com

.. This is a comment
   that spans two lines.

----------

Tables
------

+------------+------------+-----------+
| Header 1   | Header 2   | Header 3  |
+============+============+===========+
| body row 1 | column 2   | column 3  |
+------------+------------+-----------+
| spanning cell           | **bold**  |
+------------+------------+-----------+

=====  =====  ======
Name   Value  Notes
=====  =====  ======
alpha  1      First letter
beta   2      Second letter,
              continued here
=====  =====  ======

=====  =====  ======
   Inputs     Output
------------  ------
A      B      A or B
=====  =====  ======
False  False  False
True   False  True
=====  =====  ======

.. list-table:: Frameworks
   :header-rows: 1

   * - Name
     - Description
   * - Sphinx
     - Documentation generator

.. csv-table:: CSV data
   :header: "Name", "Value"

   "alpha", 1

Unicode 日本語の見出し
======================

日本語の段落です。
