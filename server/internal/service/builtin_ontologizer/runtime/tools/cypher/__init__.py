"""Candidate bundle to openCypher, and a static check on the result.

V1 generates and statically checks; it does not talk to a graph database. That is
a deliberate narrowing of 流程 §5.2's `managed graph import & conformance` — the
part that can be verified on a laptop is verified here, and `adapters/` is where a
real runtime plugs in when one is available.
"""
