# Ontology v2 implementation specification

Status: implementation in progress. Source: user-approved SPEC in the Enact integration thread, 2026-09-09. This document records the contract; completion requires the acceptance evidence below.

## Product contract

The authoritative business model contains Entity, Attribute, Relationship, Action and Policy, with Data Binding and Action Binding. Attributes belong to entities in the user interface. Actions are business contracts, not API operations; policies do not confer platform permissions. Native Semantica OWL/RDF, SHACL, SKOS, rules and knowledge graphs are compiled projections of this definition, stored in the same immutable release. Historical releases and receipts remain unchanged.

Ontology Studio remains in the Intelligence Center. Sources owns discovery, Issues owns human collaboration and investigations, Studio owns browsing/testing/version governance, Agent Ontology settings pin published releases, and Sites owns business investigation and action interaction.

## Shared wire contract

New native artifacts carry `definition.schema_version = 2`. Definition has `id`, `label`, `description`, `namespace`, and arrays `entities`, `attributes`, `relationships`, `actions`, `policies`, `data_bindings`, `action_bindings`. Business components have stable `id`, human-readable `label`, `description`, optional `aliases` and `source_refs`.

Attributes reference `entity_id` and `data_type`. Relationships reference `source_entity_id` and `target_entity_id`. Actions reference `target_entity_ids` and `policy_ids` and declare `input_schema`, `output_schema`, `preconditions`, `effects`, `postconditions`, `status`. Policies declare `kind` (permission/prohibition/obligation/constraint), `action_ids`, `condition`, `priority`, `status`. Data/action bindings preserve current execution fields and additionally reference business targets using `entity_id`, `attribute_id`, `relationship_id`, `action_id` as applicable.

`quality_v2.dimensions` contains `{key,label,numerator,denominator,status,description,engine}`. No tests means untested, not a perfect score. An unsupported check cannot authorize publication or execution.

GET/PUT `/api/semantic/agents/{agentID}/ontologies`: PUT accepts `{assignments:[{ontology_id,release_id,enabled}]}`. GET returns the same with `ontology_name`, `version`, `status`. Runtime checks the assignment independently of Skills.

Run additions: POST `context`, POST `policies`, GET/POST `plan`, GET/POST `report`, and exports of persisted report records. All retain the original Issue, release, actor and run. Recorded source steps are the authority for facts; request text is never trusted as system state.

## Human decisions

Four explicit, revision-bound gates: `scope`, `model`, `operations`, `release`. A human sees a business review packet; an agent may propose and review technically but cannot record human approval. Changed content invalidates dependent decisions. Publication requires the current exact packet. Build authorization is not business approval.

## Module specifications

- [Authoring and human review](authoring.md)
- [Studio and quality](studio.md)
- [Consumption and execution](consumption.md)
- [World map Site](site.md)

## Acceptance register

A01 source discovery and drift; A02 real human four-gate construction; A03 adaptive interview and corrections; A04 precise revision-bound review; A05 readable five elements and bindings; A06 native graph interactions; A07 real quality failures/untested states; A08 pinned Agent assignments; A09 natural-language investigation with plan, Action and Policy; A10 consistent HTML/Site/machine reports; A11 governed action and independent verification; A12 map/topology/node interactions; A13 restore and cross-evaluation existing drafts; A14 immutable history and governance.

Reference-system evidence, global demo data and performance data are separate. Global demo target: 10 countries, 50 factories, 100 suppliers, 500 batches, 100,000 VINs, 200,000 assembly links. Performance target: 1,000,000 relationships. Synthetic labels must be visible. Unknown coordinates stay unknown; GAP-006 ownership remains unresolved in reference evidence. No production actions or notifications are implied.

Performance acceptance: fixed 4 vCPU/8 GB backend and recorded Chromium test host/network; after warmup at least 100 samples; saved-investigation first interactive view p95 <= 3 s, projection/filter API p95 <= 2 s, local selection p95 <= 200 ms. Model/external-source latency is reported separately. Browser projection <= 500 nodes/1500 edges with complete match counts and pagination; 390 px usable alternative views.

Automated actor fixtures validate mechanisms and are labelled tests. Business decisions require actual member records. For this reference run, the user explicitly authorized a delegate to review and respond through the member interface; retain that attribution in the rationale. This does not count as an independent future-user usability study. Do not mark this register complete from unit-test totals alone.

补充规格：[统一模型与复用](native.md)、[Sources 连接](connections.md)。

[运行与验收记录](acceptance-evidence.md) 区分已执行证据与未完成验收。
