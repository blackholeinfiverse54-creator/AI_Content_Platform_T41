# ARTHA Ecosystem Architecture Diagrams

## 1. Capability Dependency Graph

```mermaid
graph TD
    subgraph CORE["CORE ACCOUNTING"]
        LEDGER["ARTHA-LEDGER-001<br/>Ledger Engine<br/>v1.0.0"]
        FINREPORT["ARTHA-FINREPORT-001<br/>Financial Reporting<br/>v1.0.0"]
        MULTICOMP["ARTHA-MULTICOMPANY-001<br/>Multi-Company<br/>v1.0.0"]
        TALLY["ARTHA-TALLY-001<br/>Tally Compatibility<br/>v1.0.0"]
    end

    subgraph GOVERNANCE["GOVERNANCE"]
        AUDIT["ARTHA-AUDIT-001<br/>Audit Engine<br/>v1.0.0"]
        TRACE["ARTHA-TRACE-001<br/>Trace Engine<br/>v1.0.0"]
        EVIDENCE["ARTHA-EVIDENCE-001<br/>Evidence Engine<br/>v1.0.0"]
    end

    subgraph COMPLIANCE["COMPLIANCE"]
        SIGNAL["ARTHA-SIGNAL-001<br/>Signal Engine<br/>v1.0.0"]
    end

    subgraph OPERATIONS["OPERATIONS"]
        OBSERVE["ARTHA-OBSERVE-001<br/>Observability<br/>v1.0.0"]
    end

    subgraph EXTERNAL["EXTERNAL CONSUMERS"]
        SETU["SETU"]
        TANTRA["TANTRA"]
        MITRA["MITRA"]
        UNIGURU["UniGuru"]
    end

    %% Required dependencies (solid lines)
    FINREPORT -->|reads journal entries| LEDGER
    MULTICOMP -->|reads for consolidation| LEDGER
    TALLY -->|reads for export| LEDGER
    SIGNAL -->|reads financial state| LEDGER
    SIGNAL -->|creates trace stages| TRACE
    SIGNAL -->|creates runtime proofs| EVIDENCE

    %% Optional dependencies (dashed lines)
    LEDGER -.->|records audit events| AUDIT
    LEDGER -.->|records trace stages| TRACE
    OBSERVE -.->|verifies audit chain| AUDIT
    OBSERVE -.->|monitors trace health| TRACE

    %% External consumer connections
    SETU -->|signal dispatch| SIGNAL
    TANTRA -->|trace replay| TRACE
    TANTRA -->|proof verification| EVIDENCE
    TANTRA -->|health metrics| OBSERVE
    MITRA -->|ledger queries| LEDGER
    MITRA -->|report generation| FINREPORT
    UNIGURU -->|report data| FINREPORT
    UNIGURU -->|compliance signals| SIGNAL

    %% Styling
    classDef core fill:#e1f5fe,stroke:#0288d1,stroke-width:2px
    classDef governance fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef compliance fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef operations fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef external fill:#fce4ec,stroke:#c62828,stroke-width:2px

    class LEDGER,FINREPORT,MULTICOMP,TALLY core
    class AUDIT,TRACE,EVIDENCE governance
    class SIGNAL compliance
    class OBSERVE operations
    class SETU,TANTRA,MITRA,UNIGURU external
```

## 2. Data Flow — End-to-End Transaction Lifecycle

```mermaid
sequenceDiagram
    participant C as Consumer (BHIV Product)
    participant L as Ledger Engine
    participant A as Audit Engine
    participant T as Trace Engine
    participant E as Evidence Engine
    participant S as Signal Engine
    participant O as Observability

    C->>L: POST /api/v1/ledger/entries
    L->>L: createJournalEntry() — DRAFT
    L->>T: addStage(JOURNAL_CREATED)
    L->>A: recordEvent(JOURNAL_CREATED)
    L-->>C: {entryNumber, hash, trace_id}

    C->>L: POST /api/v1/ledger/entries/:id/validate
    L->>L: validateJournalEntry() — VALIDATED
    L->>T: addStage(JOURNAL_VALIDATED)
    L->>A: recordEvent(JOURNAL_VALIDATED)
    L-->>C: {status: VALIDATED}

    C->>L: POST /api/v1/ledger/entries/:id/post
    L->>L: postJournalEntry() — POSTED
    L->>L: writeLedgerEntries() + updateAccountBalances()
    L->>T: addStage(JOURNAL_POSTED)
    L->>A: recordEvent(JOURNAL_POSTED)
    L->>E: captureChainVerification()
    L-->>C: {status: POSTED}

    O->>O: recordRequest(duration)
    O->>O: getSystemHealth() — point-in-time snapshot
```

## 3. Authority Boundary Enforcement

```mermaid
graph LR
    subgraph BOUNDARIES["AUTHORITY BOUNDARIES"]
        direction TB
        
        subgraph L["LEDGER OWNS"]
            L1["Journal lifecycle"]
            L2["Hash chain"]
            L3["Account balances"]
        end
        
        subgraph L_NOT["LEDGER DOES NOT OWN"]
            L_N1["Invoice lifecycle"]
            L_N2["Expense approval"]
            L_N3["GST calculation"]
        end
        
        subgraph A["AUDIT OWNS"]
            A1["Audit events"]
            A2["Hash chain"]
            A3["Audit trails"]
        end
        
        subgraph A_NOT["AUDIT DOES NOT OWN"]
            A_N1["Business logic"]
            A_N2["User auth"]
        end
        
        subgraph T["TRACE OWNS"]
            T1["Trace lifecycle"]
            T2["Stage recording"]
            T3["Continuity check"]
        end
        
        subgraph T_NOT["TRACE DOES NOT OWN"]
            T_N1["Signal generation"]
            T_N2["SETU dispatch"]
        end
    end

    style L fill:#e1f5fe
    style L_NOT fill:#ffebee
    style A fill:#f3e5f5
    style A_NOT fill:#ffebee
    style T fill:#e8f5e9
    style T_NOT fill:#ffebee
```

## 4. Trace Continuity Flow

```mermaid
stateDiagram-v2
    [*] --> TRANSACTION_CREATED: initializeTrace()
    TRANSACTION_CREATED --> JOURNAL_CREATED: createJournalEntry()
    JOURNAL_CREATED --> JOURNAL_VALIDATED: validateJournalEntry()
    JOURNAL_VALIDATED --> JOURNAL_POSTED: postJournalEntry()
    
    state "Optional Stages" as opt {
        JOURNAL_POSTED --> SIGNAL_GENERATED: emitSignal()
        SIGNAL_GENERATED --> FILING_CREATED: generateFiling()
        FILING_CREATED --> FILING_VALIDATED: validateFiling()
        FILING_VALIDATED --> SETU_DISPATCHED: dispatchToSetu()
        SETU_DISPATCHED --> SETU_ACKNOWLEDGED: parseAck()
        SETU_ACKNOWLEDGED --> CONFIRMED: ack received
    }
    
    JOURNAL_POSTED --> COMPLETED: completeTrace()
    
    state "Failure Paths" as fail {
        SETU_DISPATCHED --> SETU_REJECTED: ack=REJECTED
        SETU_DISPATCHED --> RETRY_SCHEDULED: timeout/5xx
        RETRY_SCHEDULED --> RETRY_IN_PROGRESS: retry attempt
        RETRY_IN_PROGRESS --> SETU_DISPATCHED: re-dispatch
        RETRY_IN_PROGRESS --> RETRY_EXHAUSTED: max retries
        RETRY_EXHAUSTED --> DEAD_LETTER: escalate
    }
    
    COMPLETED --> [*]
    DEAD_LETTER --> [*]
```

## 5. SETU Pipeline Architecture

```mermaid
graph LR
    subgraph PIPELINE["SETU PIPELINE (Pure Functions)"]
        direction LR
        
        S1["1. NORMALIZE<br/>normalizeSignal()<br/>Harmonizes input shapes"]
        S2["2. VALIDATE<br/>validateSignal()<br/>26 types, 6 modules, 5 entities"]
        S3["3. MAP<br/>mapToSetuPayload()<br/>Canonical contract shape"]
        S4["4. SERIALIZE<br/>serializeForSetu()<br/>Idempotency key, content hash"]
        
        S1 --> S2 --> S3 --> S4
    end
    
    subgraph DISPATCH["DISPATCH LAYER"]
        D1["SetuDispatch Record"]
        D2["HTTP POST to SETU"]
        D3["Parse Acknowledgement"]
        D4["RuntimeProof Capture"]
        
        D1 --> D2 --> D3 --> D4
    end
    
    subgraph RETRY["RETRY MECHANISM"]
        R1{"Retryable?"}
        R2["Exponential Backoff<br/>2^attempt × 60s"]
        R3["Dead Letter Queue"]
        
        R1 -->|Yes: 5xx, timeout, 429| R2
        R1 -->|No: 4xx (not 429)| R3
        R2 -->|Max 3 retries| R3
    end
    
    S4 --> D1
    D4 --> R1
    
    style S1 fill:#e3f2fd
    style S2 fill:#e3f2fd
    style S3 fill:#e3f2fd
    style S4 fill:#e3f2fd
```

## 6. Capability Consumer Map

```mermaid
graph TB
    subgraph ARTHA["ARTHA CAPABILITY PROVIDER"]
        C1["LEDGER-001"]
        C2["AUDIT-001"]
        C3["TRACE-001"]
        C4["EVIDENCE-001"]
        C5["OBSERVE-001"]
        C6["FINREPORT-001"]
        C7["SIGNAL-001"]
        C8["MULTICOMPANY-001"]
        C9["TALLY-001"]
    end
    
    subgraph SETU_C["SETU"]
        S1["Signal Ingestion"]
        S2["Dispatch Tracking"]
    end
    
    subgraph TANTRA_C["TANTRA"]
        T1["Trace Replay"]
        T2["Proof Verification"]
        T3["Heartbeat"]
    end
    
    subgraph MITRA_C["MITRA (Future)"]
        M1["Ledger Queries"]
        M2["Report Generation"]
    end
    
    subgraph UNIGURU_C["UniGuru (Future)"]
        U1["Report Data"]
        U2["Compliance Signals"]
    end
    
    subgraph K8S["KUBERNETES"]
        K1["Liveness Probe"]
        K2["Readiness Probe"]
    end
    
    subgraph MONITORING["PROMETHEUS/GRAFANA"]
        P1["Metrics Scraping"]
        P2["Dashboard"]
    end
    
    C7 --> S1
    C3 --> S2
    C3 --> T1
    C4 --> T2
    C5 --> T3
    C5 --> K1
    C5 --> K2
    C5 --> P1
    C5 --> P2
    C1 --> M1
    C6 --> M2
    C6 --> U1
    C7 --> U2
    
    style ARTHA fill:#e8eaf6
    style SETU_C fill:#fff3e0
    style TANTRA_C fill:#fce4ec
    style MITRA_C fill:#e0f7fa
    style UNIGURU_C fill:#f1f8e9
    style K8S fill:#fff8e1
    style MONITORING fill:#ede7f6
```
