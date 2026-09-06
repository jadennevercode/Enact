"""Render a sealed ontology revision into an installable Skill package.

This is the consumption side. Everything upstream produces a governed model; this
turns that model into something an agent can load as context — which is the point
of building it (白皮书 §8.2: an ontology is not the context, it is the context
generator).

Rendering is deterministic: same revision in, byte-identical package out. That is
what lets `skill_package_current` check that a shipped package still matches the
revision it claims to come from.
"""
