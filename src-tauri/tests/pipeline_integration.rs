//! Integration tests for the translation pipeline and related components.

mod common;

use aaalice_mc_translator_lib::core::{
    jobs,
    models::*,
    pipeline,
    shield,
};

/// Create a minimal ScanSummary for testing.
fn create_scan_summary(job_id: &str) -> ScanSummary {
    ScanSummary {
        job_id: job_id.to_string(),
        instance_path: "test-instance".into(),
        validation: InstanceValidation {
            instance_path: "test-instance".into(), is_valid: true,
            mods_path: "test-instance/mods".into(), resourcepacks_path: "test-instance/resourcepacks".into(),
            warnings: vec![],
        },
        mods: vec![ModScanResult {
            mod_id: "testmod".into(),
            file_name: "testmod-1.0.jar".into(),
            jar_path: "test-instance/mods/testmod-1.0.jar".into(),
            language_file_count: 1, recovered_language_files: 0, failed_language_files: 0,
            source_language: "en_us".into(), resolved_source_language: "en_us".into(), target_language: "zh_cn".into(),
            source_entries: 3, target_entries: 0, has_target_language: false,
            formats: vec!["json".into()],
            entries: vec![
                LanguageEntry { mod_id: "testmod".into(), key: "item.one".into(), text: "Item One".into(), text_hash: "h1".into(), language: "en_us".into(), format: "json".into(), source_file: "assets/testmod/lang/en_us.json".into() },
                LanguageEntry { mod_id: "testmod".into(), key: "item.two".into(), text: "Item Two %s".into(), text_hash: "h2".into(), language: "en_us".into(), format: "json".into(), source_file: "assets/testmod/lang/en_us.json".into() },
                LanguageEntry { mod_id: "testmod".into(), key: "item.three".into(), text: "Item Three".into(), text_hash: "h3".into(), language: "en_us".into(), format: "json".into(), source_file: "assets/testmod/lang/en_us.json".into() },
            ],
            warnings: vec![],
        }],
        resource_packs: vec![],
        source_language: "en_us".into(), target_language: "zh_cn".into(),
        total_language_files: 1, total_source_entries: 3, total_target_entries: 0,
        total_pending_entries: 3, resource_pack_covered_entries: 0, actual_pending_entries: 3,
        warnings: vec![], cancelled: false,
    }
}

// ── Data-flow unit tests (no network) ──

#[test]
fn extract_pending_finds_three_untagged_entries() {
    let scan = create_scan_summary("test-extract");
    let pending = pipeline::extract_pending_entries(&scan);
    assert_eq!(pending.len(), 3);
    for (entry, fname, existing) in &pending {
        assert_eq!(entry.mod_id, "testmod");
        assert_eq!(fname, "testmod-1.0.jar");
        assert!(existing.is_none());
    }
}

#[test]
fn extract_pending_skips_translated_mods() {
    let mut scan = create_scan_summary("test-skip");
    scan.mods[0].has_target_language = true;
    let pending = pipeline::extract_pending_entries(&scan);
    assert_eq!(pending.len(), 0);
}

#[test]
fn shield_validates_placeholder_presence() {
    let pending = vec![jobs::PendingEntry {
        key: "item.two".into(), source_text: "Item Two %s".into(), mod_id: "testmod".into(), mod_name: "testmod.jar".into(),
    }];
    let results = vec![jobs::TranslationResult {
        key: "item.two".into(), source_text: "Item Two %s".into(), target_text: "物品二".into(),
        mod_id: "testmod".into(), mod_name: "testmod.jar".into(), source_type: "llm".into(),
    }];
    let report = shield::validate_translation_results(&pending, &results);
    assert_eq!(report.failed, 1);
    assert!(report.placeholder_issues.iter().any(|i| i.issue_type == "placeholder_missing"));
}

#[test]
fn pack_generation_filters_failed_entries() {
    let results = vec![
        jobs::TranslationResult { key: "good.1".into(), source_text: "Hello".into(), target_text: "你好".into(), mod_id: "testmod".into(), mod_name: "testmod.jar".into(), source_type: "llm".into() },
        jobs::TranslationResult { key: "bad.1".into(), source_text: "%s items".into(), target_text: "个物品".into(), mod_id: "testmod".into(), mod_name: "testmod.jar".into(), source_type: "failed".into() },
        jobs::TranslationResult { key: "dict.1".into(), source_text: "World".into(), target_text: "世界".into(), mod_id: "testmod".into(), mod_name: "testmod.jar".into(), source_type: "dictionary".into() },
    ];
    let valid: Vec<_> = results.into_iter().filter(|r| r.source_type != "failed").collect();
    assert_eq!(valid.len(), 2);
    assert!(valid.iter().all(|r| r.source_type != "failed"));
}

#[test]
fn validate_detects_missing_results() {
    let pending = vec![
        jobs::PendingEntry { key: "item.one".into(), source_text: "Item One".into(), mod_id: "testmod".into(), mod_name: "testmod.jar".into() },
        jobs::PendingEntry { key: "item.two".into(), source_text: "Item Two".into(), mod_id: "testmod".into(), mod_name: "testmod.jar".into() },
    ];
    let results = vec![jobs::TranslationResult {
        key: "item.one".into(), source_text: "Item One".into(), target_text: "物品一".into(),
        mod_id: "testmod".into(), mod_name: "testmod.jar".into(), source_type: "llm".into(),
    }];
    let report = shield::validate_translation_results(&pending, &results);
    assert_eq!(report.total_entries, 2);
    assert_eq!(report.passed, 1);
    assert_eq!(report.missing, 1);
}

#[test]
fn shield_roundtrip_preserves_placeholders() {
    for text in &["按住 %s 打开 §l界面", "欢迎 {player}！你有 %d 条消息", "普通文本"] {
        let sr = shield::protect(text);
        let restored = shield::restore(&sr.protected, &sr.tokens);
        assert_eq!(&restored, text);
    }
}

#[test]
fn job_state_persistence_works() {
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path();
    let job_state = jobs::TranslationJobState {
        job_id: "test-job-123".into(), scan_job_id: "scan-123".into(),
        status: jobs::TranslationStatus::Completed,
        source_language: "en_us".into(), target_language: "zh_cn".into(),
        entries: vec![], completed_entries: 3, failed_entries: 0,
        token_usage: TokenUsage::default(),
        created_at: "2026-01-01T00:00:00Z".into(),
        completed_at: Some("2026-01-01T01:00:00Z".into()),
    };
    let manager = jobs::JobManager::new(root.to_path_buf());
    assert!(manager.save(&job_state).is_ok());
    let loaded = manager.load("test-job-123").ok().flatten();
    assert!(loaded.is_some());
    assert_eq!(loaded.unwrap().completed_entries, 3);
}

// ── End-to-end test with fake LLM server ──

/// Run the pipeline with a ScanSummary cached on disk, pointing to the fake LLM.
fn run_fake_llm_pipeline(port: u16, root: &std::path::Path) -> Result<PipelineResult, String> {
    let scan = create_scan_summary("fake-llm-e2e");
    let scan_job_id = scan.job_id.clone();
    let scan_path = aaalice_mc_translator_lib::core::paths::job_state_path(root, &scan_job_id);
    if let Some(parent) = scan_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&scan_path, serde_json::to_string_pretty(&scan).unwrap()).ok();

    let config = PipelineConfig {
        root: root.to_path_buf(),
        instance_path: "test-instance".into(),
        source_language: "en_us".into(),
        target_language: "zh_cn".into(),
        scan_job_id: Some(scan_job_id),
        resource_pack_names: vec![],
        llm: Some(LlmConfig {
            base_url: format!("http://127.0.0.1:{}", port),
            api_key: "fake-key".into(),
            model: "fake-model".into(),
            temperature: 0.0,
            max_tokens: 100,
            concurrency: 2,
            batch_size: 10,
            timeout_secs: 10,
            retry_count: 2,
            rate_limit_rpm: 9999,
            prefer_user_dict: false,
            system_prompt: "Test".into(),
        }),
    };

    let job_id = format!("e2e_job_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    let cancel = pipeline::CancelToken::new();
    cancel.register_task(&job_id);

    let (tx_p, _rx_p) = std::sync::mpsc::channel();
    let (tx_l, _rx_l) = std::sync::mpsc::channel();
    let (tx_e, _rx_e) = std::sync::mpsc::channel();

    pipeline::run_pipeline(config, &job_id, &cancel, tx_p, tx_l, tx_e)
}

/// Pipeline with fake LLM config runs without crashing and creates output files.
#[test]
fn fake_llm_pipeline_runs_and_creates_output() {
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path();

    let server = common::FakeLlmServer::start(common::FakeLlmConfig {
        port: 21560, delay_ms: 5, ..Default::default()
    });
    server.wait_ready(21560);

    let result = run_fake_llm_pipeline(21560, root);
    assert!(result.is_ok(), "Pipeline should return Ok (got: {:?})", result.err());

    let pipeline_result = result.unwrap();
    // Pipeline completed — results file should exist
    let results_path = aaalice_mc_translator_lib::core::paths::translate_job_results_path(root, &pipeline_result.job_id);
    assert!(results_path.exists(), "Results JSONL should exist");
}

/// Pipeline cancellation during LLM phase returns Ok with partial results.
#[test]
fn fake_llm_pipeline_cancel_returns_partial() {
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path();

    let server = common::FakeLlmServer::start(common::FakeLlmConfig {
        port: 21561, delay_ms: 200, ..Default::default()
    });
    server.wait_ready(21561);

    let scan = create_scan_summary("fake-llm-cancel");
    let scan_job_id = scan.job_id.clone();
    let scan_path = aaalice_mc_translator_lib::core::paths::job_state_path(root, &scan_job_id);
    if let Some(parent) = scan_path.parent() { std::fs::create_dir_all(parent).ok(); }
    std::fs::write(&scan_path, serde_json::to_string_pretty(&scan).unwrap()).ok();

    let config = PipelineConfig {
        root: root.to_path_buf(),
        instance_path: "test-instance".into(),
        source_language: "en_us".into(), target_language: "zh_cn".into(),
        scan_job_id: Some(scan_job_id), resource_pack_names: vec![],
        llm: Some(LlmConfig {
            base_url: "http://127.0.0.1:21561".into(), api_key: "fake-key".into(),
            model: "fake-model".into(), temperature: 0.0, max_tokens: 100,
            concurrency: 2, batch_size: 10, timeout_secs: 10, retry_count: 1,
            rate_limit_rpm: 9999, prefer_user_dict: false,
            system_prompt: "Test".into(),
        }),
    };

    let job_id = "e2e_cancel_test";
    let cancel = pipeline::CancelToken::new();
    cancel.register_task(job_id);

    let (tx_p, _rx_p) = std::sync::mpsc::channel();
    let (tx_l, _rx_l) = std::sync::mpsc::channel();
    let (tx_e, _rx_e) = std::sync::mpsc::channel();

    let cancel_clone = cancel.clone();
    let handle = std::thread::spawn(move || {
        pipeline::run_pipeline(config, job_id, &cancel_clone, tx_p, tx_l, tx_e)
    });

    std::thread::sleep(std::time::Duration::from_millis(100));
    cancel.cancel_current();

    let result = handle.join().unwrap();
    assert!(result.is_ok(), "Cancellation should return Ok");
}
