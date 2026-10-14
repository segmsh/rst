"""Prints the docutils doctree structure and visible text of an RST file as JSON."""

import io
import json
import sys

from docutils import nodes
from docutils.core import publish_doctree
from docutils.parsers.rst import Directive, directives


class VersionChange(Directive):
    """Stand-in for Sphinx's versionadded family: the explanation is inline text."""

    required_arguments = 1
    optional_arguments = 1
    final_argument_whitespace = True
    has_content = True

    def run(self):
        node = nodes.container()
        if len(self.arguments) > 1:
            inline, messages = self.state.inline_text(self.arguments[1], self.lineno)
            node += nodes.paragraph(self.arguments[1], "", *inline)
            node += messages
        self.state.nested_parse(self.content, self.content_offset, node)
        return [node]


class ObjectDescription(Directive):
    """Stand-in for Sphinx domain directives (py:function, ...): the content is body text."""

    optional_arguments = 1
    final_argument_whitespace = True
    has_content = True

    def run(self):
        node = nodes.container()
        self.state.nested_parse(self.content, self.content_offset, node)
        return [node]


for name in ("versionadded", "versionchanged", "deprecated", "versionremoved"):
    directives.register_directive(name, VersionChange)

for name in ("py:function", "py:class", "py:method"):
    directives.register_directive(name, ObjectDescription)

source = open(sys.argv[1], encoding="utf-8").read()
doctree = publish_doctree(
    source,
    settings_overrides={"report_level": 1, "halt_level": 5, "warning_stream": io.StringIO()},
)

def is_info(node):
    """Informational messages, e.g. duplicate implicit names when titles and links get the same translation."""
    while node is not None:
        if isinstance(node, nodes.system_message) and node["level"] < 2:
            return True
        node = node.parent
    return False


signature = []
for node in doctree.findall(nodes.Element):
    # Translation may add targets that keep links to titles and renamed links working
    if isinstance(node, nodes.target) or is_info(node):
        continue
    if isinstance(node, nodes.system_message):
        signature.append(f"system_message:{node['level']}:{node.get('type', '')}")
    elif isinstance(node, nodes.entry):
        # Cell spans must survive translation
        signature.append(f"entry:{node.get('morecols', 0)}:{node.get('morerows', 0)}")
    elif not isinstance(node, nodes.document):
        signature.append(node.tagname)

# Translatable attributes are not part of the visible text
attributes = [node["alt"] for node in doctree.findall(nodes.image) if "alt" in node]
attributes += [doctree["title"]] if "title" in doctree else []

text = " ".join([doctree.astext(), *attributes])

print(json.dumps({"signature": signature, "text": " ".join(text.split())}))
