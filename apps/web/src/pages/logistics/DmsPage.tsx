// apps/web/src/pages/logistics/DmsPage.tsx
import { useEffect, useState } from 'react';
import { logisticsApi } from '../../lib/logisticsApi';

const Folder = ({ className = '' }: { className?: string }) => <span className={className}>📁</span>;
const FileText = ({ className = '' }: { className?: string }) => <span className={className}>📄</span>;
const Search = ({ className = '' }: { className?: string }) => <span className={className}>🔍</span>;
const Lock = ({ className = '' }: { className?: string }) => <span className={className}>🔒</span>;
const Unlock = ({ className = '' }: { className?: string }) => <span className={className}>🔓</span>;
const ShieldAlert = ({ className = '' }: { className?: string }) => <span className={className}>🛡️</span>;
const Plus = ({ className = '' }: { className?: string }) => <span className={className}>+</span>;
const Share2 = ({ className = '' }: { className?: string }) => <span className={className}>🔗</span>;
const History = ({ className = '' }: { className?: string }) => <span className={className}>⏪</span>;

export function DmsPage() {
  const [folders, setFolders] = useState<any[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [docs, setDocs] = useState<any[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<any | null>(null);
  const [tags, setTags] = useState<any[]>([]);
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderConf, setFolderConf] = useState<'PUBLIC' | 'INTERNAL' | 'RESTRICTED'>('INTERNAL');
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [docForm, setDocForm] = useState({ title: '', description: '', rawTextContent: '', tagCodes: '' });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const loadWorkspace = async (qStr = searchQuery, fId = selectedFolderId, tagStr = activeTag) => {
    try {
      const [f, d, t, disp] = await Promise.all([
        logisticsApi.listFolders(),
        logisticsApi.searchDocuments(qStr, fId || undefined, tagStr || undefined),
        logisticsApi.listTags(),
        logisticsApi.listDispositions(),
      ]);
      setFolders(f);
      setDocs(d);
      setTags(t);
      setDispositions(disp);
    } catch {
      // handled silently
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, []);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await loadWorkspace(searchQuery, selectedFolderId, activeTag);
  };

  const handleCreateFolder = async () => {
    setErrorMsg(null);
    if (!folderName.trim()) return;
    try {
      await logisticsApi.createFolder({
        name: folderName,
        parentId: selectedFolderId || undefined,
        confidentiality: folderConf,
        retentionYears: 8,
      });
      setFolderName('');
      setShowNewFolder(false);
      await loadWorkspace();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not create folder.');
    }
  };

  const handleCreateDoc = async () => {
    setErrorMsg(null);
    if (!selectedFolderId) {
      setErrorMsg('Select a folder in the tree first.');
      return;
    }
    try {
      await logisticsApi.createDocument({
        folderId: selectedFolderId,
        title: docForm.title,
        description: docForm.description,
        rawTextContent: docForm.rawTextContent,
        tagCodes: docForm.tagCodes
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      });
      setShowNewDoc(false);
      setDocForm({ title: '', description: '', rawTextContent: '', tagCodes: '' });
      await loadWorkspace();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Document upload blocked.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-indigo-600" />
            Document Management System (DMS)
          </h1>
          <p className="text-sm text-slate-500">
            Folders (ltree), ISO 15489 retention & legal hold, ACL access control, Postgres FTS search
          </p>
        </div>
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-lg">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents (Postgres 'simple' FTS & fuzzy title)..."
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <button type="submit" className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">
            Search
          </button>
        </form>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-300 text-red-800 px-4 py-2.5 rounded-lg text-sm">
          {errorMsg}
        </div>
      )}

      {/* Three-Pane DMS Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Pane 1: Folder Tree & Tags */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-slate-500">Folders</span>
            <button
              onClick={() => setShowNewFolder(true)}
              className="text-xs text-indigo-600 font-medium flex items-center gap-1 hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>
          <div className="space-y-1">
            <button
              onClick={() => {
                setSelectedFolderId('');
                void loadWorkspace(searchQuery, '', activeTag);
              }}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm flex items-center gap-2 ${
                selectedFolderId === '' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Folder className="w-4 h-4" /> All Accessible
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setSelectedFolderId(f.id);
                  void loadWorkspace(searchQuery, f.id, activeTag);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm flex items-center justify-between ${
                  selectedFolderId === f.id ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Folder className="w-4 h-4 shrink-0" />
                  <span className="truncate">{f.name}</span>
                </span>
                {f.confidentiality === 'RESTRICTED' && (
                  <Lock className="w-3.5 h-3.5 text-red-600 shrink-0" />
                )}
              </button>
            ))}
          </div>

          <div className="border-t pt-3 space-y-2">
            <div className="text-xs font-bold uppercase text-slate-500">Tags Facet</div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    const nextTag = activeTag === t.code ? '' : t.code;
                    setActiveTag(nextTag);
                    void loadWorkspace(searchQuery, selectedFolderId, nextTag);
                  }}
                  className={`px-2 py-0.5 rounded text-xs font-medium border ${
                    activeTag === t.code
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  #{t.code}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Pane 2: Documents Grid */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-slate-500">Documents ({docs.length})</span>
            <button
              onClick={() => setShowNewDoc(true)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add Document
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {docs.length === 0 ? (
              <div className="text-sm text-slate-500 py-10 text-center">No matching accessible documents.</div>
            ) : (
              docs.map((d) => (
                <div
                  key={d.id}
                  onClick={() => {
                    setSelectedDoc(d);
                    setShareUrl(null);
                  }}
                  className={`py-3 px-2 rounded-lg cursor-pointer hover:bg-slate-50 space-y-1 ${
                    selectedDoc?.id === d.id ? 'bg-indigo-50/70' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-indigo-700">{d.docCode}</span>
                    <div className="flex items-center gap-1.5">
                      {d.legalHold && (
                        <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">HOLD</span>
                      )}
                      {d.checkedOutById && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">CHECKED OUT</span>
                      )}
                      <span className="text-[11px] text-slate-500">v{d.currentVersionNo}</span>
                    </div>
                  </div>
                  <div className="font-semibold text-sm text-slate-900">{d.title}</div>
                  <div className="text-xs text-slate-500">{d.folderName} • Due: {d.dispositionDue ? String(d.dispositionDue).slice(0, 10) : '-'}</div>
                  {d.snippet && (
                    <div
                      className="text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded"
                      dangerouslySetInnerHTML={{ __html: String(d.snippet) }}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pane 3: Preview, Versioning, Checkout & Retention */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          {selectedDoc ? (
            <>
              <div className="border-b pb-3">
                <div className="font-mono text-xs text-indigo-600 font-bold">{selectedDoc.docCode}</div>
                <h3 className="font-bold text-slate-900">{selectedDoc.title}</h3>
                <p className="text-xs text-slate-500 mt-1">{selectedDoc.description || 'No description'}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedDoc.checkedOutById ? (
                  <button
                    onClick={async () => {
                      await logisticsApi.checkinDocument(selectedDoc.id, { changeNote: 'Checked in via web UI' });
                      await loadWorkspace();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium flex items-center gap-1"
                  >
                    <Unlock className="w-3.5 h-3.5" /> Check-In
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      try {
                        await logisticsApi.checkoutDocument(selectedDoc.id);
                        await loadWorkspace();
                      } catch (e: any) {
                        setErrorMsg(e?.message || 'Cannot checkout');
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium flex items-center gap-1"
                  >
                    <Lock className="w-3.5 h-3.5" /> Check-Out
                  </button>
                )}

                <button
                  onClick={async () => {
                    await logisticsApi.setLegalHold(selectedDoc.id, !selectedDoc.legalHold, 'Legal review hold');
                    await loadWorkspace();
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 border ${
                    selectedDoc.legalHold
                      ? 'bg-red-50 text-red-700 border-red-300'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  {selectedDoc.legalHold ? 'Release Legal Hold' : 'Apply Legal Hold'}
                </button>

                <button
                  onClick={async () => {
                    const link = await logisticsApi.createShareLink(selectedDoc.id, { expiresHours: 72 });
                    setShareUrl(`${window.location.origin}/share/${link.rawToken}`);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white text-slate-700 border border-slate-300 text-xs font-medium flex items-center gap-1"
                >
                  <Share2 className="w-3.5 h-3.5" /> Share Link
                </button>

                {selectedDoc.currentVersionNo > 1 && (
                  <button
                    onClick={async () => {
                      await logisticsApi.rollbackDocument(selectedDoc.id, selectedDoc.currentVersionNo - 1);
                      await loadWorkspace();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white text-slate-700 border border-slate-300 text-xs font-medium flex items-center gap-1"
                  >
                    <History className="w-3.5 h-3.5" /> Rollback v{selectedDoc.currentVersionNo - 1}
                  </button>
                )}
              </div>

              {shareUrl && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-mono break-all text-emerald-800">
                  {shareUrl}
                </div>
              )}

              <div className="border-t pt-3 space-y-2 text-xs">
                <div className="font-bold text-slate-600 uppercase">Retention & ISO 15489</div>
                <div>Confidentiality: <strong>{selectedDoc.confidentiality}</strong></div>
                <div>Disposition Due: <strong>{selectedDoc.dispositionDue ? String(selectedDoc.dispositionDue).slice(0, 10) : '8 years from creation'}</strong></div>
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500 py-12 text-center">
              Select a document to inspect versions, checkout lock, ACLs, and retention metadata.
            </div>
          )}

          {dispositions.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <div className="text-xs font-bold uppercase text-slate-500">Retention Queue</div>
              {dispositions.slice(0, 5).map((disp) => (
                <div key={disp.id} className="text-xs flex items-center justify-between bg-slate-50 p-2 rounded">
                  <span>{disp.docCode} ({disp.approvalStatus})</span>
                  {disp.approvalStatus === 'PENDING' && (
                    <button
                      onClick={async () => {
                        await logisticsApi.approveDisposition(disp.id);
                        await loadWorkspace();
                      }}
                      className="px-2 py-0.5 bg-red-600 text-white rounded"
                    >
                      Approve Destroy
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showNewFolder && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 space-y-3">
            <h3 className="font-bold text-slate-900">Create Folder</h3>
            <input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Folder Name"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <select
              value={folderConf}
              onChange={(e) => setFolderConf(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              <option value="INTERNAL">INTERNAL (Inherits ACL)</option>
              <option value="PUBLIC">PUBLIC (View/Download all)</option>
              <option value="RESTRICTED">RESTRICTED (Explicit ACL only)</option>
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewFolder(false)} className="px-3 py-1.5 text-sm text-slate-600">Cancel</button>
              <button onClick={handleCreateFolder} className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm">Create</button>
            </div>
          </div>
        </div>
      )}

      {showNewDoc && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-3 text-sm">
            <h3 className="font-bold text-slate-900">Register Document</h3>
            <input
              value={docForm.title}
              onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
              placeholder="Document Title"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
            <input
              value={docForm.description}
              onChange={(e) => setDocForm({ ...docForm, description: e.target.value })}
              placeholder="Description"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
            <textarea
              value={docForm.rawTextContent}
              onChange={(e) => setDocForm({ ...docForm, rawTextContent: e.target.value })}
              placeholder="Indexed text / content summary"
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
            <input
              value={docForm.tagCodes}
              onChange={(e) => setDocForm({ ...docForm, tagCodes: e.target.value })}
              placeholder="Tags (comma-separated, e.g. ISO, QA)"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewDoc(false)} className="px-3 py-1.5 text-slate-600">Cancel</button>
              <button onClick={handleCreateDoc} className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
