import { BookOpen, Download, Search, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import {
  deleteDictionaryEntry,
  getDictionaryStats,
  importTranslationResultsToDictionary,
  searchDictionary,
  updateDictionaryEntry,
} from "../api/tauri";
import { t } from "../i18n/translations";
import type { AppLanguage, DictionaryEntry, DictionaryStats } from "../types";

interface Props {
  language: AppLanguage;
}

export function DictionaryPage({ language }: Props) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [stats, setStats] = useState<DictionaryStats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);

  const fetchEntries = async () => {
    setLoading(true);
    setError("");
    try {
      const results = await searchDictionary(
        searchQuery || undefined,
        sourceTypeFilter || undefined,
      );
      setEntries(results);
      const s = await getDictionaryStats();
      setStats(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const s = await getDictionaryStats();
      setStats(s);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchEntries();
  }, [sourceTypeFilter]);

  useEffect(() => {
    fetchStats();
  }, []);

  const handleImport = async () => {
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const result = await importTranslationResultsToDictionary();
      setMessage(`已导入 ${result.imported} 条，跳过 ${result.skipped} 条` + (result.conflicts.length > 0 ? `，${result.conflicts.length} 条冲突` : ""));
      fetchEntries();
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleSearch = () => fetchEntries();

  const handleEdit = (entry: DictionaryEntry) => {
    setEditingId(entry.id ?? null);
    setEditText(entry.targetText);
  };

  const handleSaveEdit = async () => {
    if (editingId === null) return;
    setError("");
    setMessage("");
    try {
      await updateDictionaryEntry(editingId, editText);
      setMessage(t(language, "dictionary.saved"));
      setEditingId(null);
      fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: number) => {
    setError("");
    setMessage("");
    try {
      await deleteDictionaryEntry(id);
      setMessage(t(language, "dictionary.deleted"));
      fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>{t(language, "dictionary.title")}</h1>
          <p>
            {stats
              ? t(language, "dictionary.subtitle", { total: stats.total, mods: stats.modIds.length })
              : t(language, "dictionary.subtitleEmpty")}
          </p>
        </div>
        <div className="page-header-button">
          <button
            className="ghost-button"
            type="button"
            disabled={!isTauriRuntime() || importing}
            onClick={handleImport}
            data-tooltip="从已有翻译导入词典"
          >
            <Download size={17} />
            {importing ? "导入中..." : "导入已有翻译"}
          </button>
          <button className="ghost-button" type="button" disabled={!isTauriRuntime()} data-tooltip={t(language, "tooltip.export")}>
            <Download size={17} />
            {t(language, "dictionary.export")}
          </button>
          <button className="ghost-button" type="button" disabled={!isTauriRuntime()} data-tooltip={t(language, "tooltip.import")}>
            <Upload size={17} />
            {t(language, "dictionary.import")}
          </button>
        </div>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="instance-row">
        <label className="search-field">
          <Search size={17} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={t(language, "dictionary.searchPlaceholder")}
          />
        </label>
        <select
          value={sourceTypeFilter}
          onChange={(e) => setSourceTypeFilter(e.target.value)}
          className="filter-select"
        >
          <option value="">{t(language, "dictionary.allTypes")}</option>
          <option value="manual">{t(language, "dictionary.typeManual")}</option>
          <option value="resourcepack">{t(language, "dictionary.typeResourcepack")}</option>
          <option value="cfpa">{t(language, "dictionary.typeCfpa")}</option>
          <option value="llm">{t(language, "dictionary.typeLlm")}</option>
        </select>
        <button className="ghost-button" onClick={handleSearch} type="button" data-tooltip={t(language, "tooltip.search")}>
          <Search size={17} />
          {t(language, "dictionary.search")}
        </button>
      </div>

      {loading && <div className="empty-state">{t(language, "common.loading")}</div>}

      {!loading && entries.length === 0 && (
        <div className="empty-state">
          <BookOpen size={32} />
          <p>{t(language, "dictionary.empty")}</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t(language, "dictionary.col.source")}</th>
                <th>{t(language, "dictionary.col.target")}</th>
                <th>{t(language, "dictionary.col.mod")}</th>
                <th>{t(language, "dictionary.col.key")}</th>
                <th>{t(language, "dictionary.col.type")}</th>
                <th>{t(language, "dictionary.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 500).map((entry) => (
                <tr key={entry.id}>
                  <td title={entry.sourceText}>{entry.sourceText}</td>
                  <td>
                    {editingId === entry.id ? (
                      <div className="inline-edit">
                        <input
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          autoFocus
                        />
                        <button className="text-button" onClick={handleSaveEdit} type="button">
                          {t(language, "common.save")}
                        </button>
                        <button className="text-button" onClick={handleCancelEdit} type="button">
                          {t(language, "common.cancel")}
                        </button>
                      </div>
                    ) : (
                      <span
                        className="editable-text"
                        onClick={() => handleEdit(entry)}
                        title={t(language, "dictionary.clickToEdit")}
                      >
                        {entry.targetText}
                      </span>
                    )}
                  </td>
                  <td>{entry.modId ?? "-"}</td>
                  <td className="mono">{entry.translationKey ?? "-"}</td>
                  <td>
                    <span className={`badge ${entry.sourceType}`}>{entry.sourceType}</span>
                  </td>
                  <td>
                    <button
                      className="ghost-button danger"
                      onClick={() => entry.id && handleDelete(entry.id)}
                      type="button"
                      data-tooltip={t(language, "tooltip.delete")}
                    >
                      {t(language, "common.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries.length > 500 && (
        <div className="alert warning">
          {t(language, "dictionary.moreResults", { count: entries.length - 500 })}
        </div>
      )}
    </section>
  );
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
