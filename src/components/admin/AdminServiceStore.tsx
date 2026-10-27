import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CreditCard, ImagePlus, LoaderCircle, PackagePlus, Pencil, Plus, Save, Settings2, ShoppingBag, Trash2, X } from 'lucide-react';
import { billingTypeLabel, formatServicePrice, type ServiceBillingType, type ServiceCatalogueBadge, type ServiceCatalogueCategory, type ServicePackage, type ServicePackageKind } from '../../data/serviceCatalogue';
import { normalizeCatalogueCategoryName, serviceCatalogueSlug, uniqueServiceCatalogueSlug } from '../../data/serviceCatalogueCategories';
import { AdminPaymentReceiving } from './AdminPaymentReceiving';
import { AdminServiceOrders } from './AdminServiceOrders';
import { uploadAdminMedia } from './uploadAdminMedia';

interface PackageForm {
  slug: string;
  categoryId: string;
  packageCode: string;
  title: string;
  category: string;
  packageKind: ServicePackageKind;
  summary: string;
  description: string;
  priceInr: string;
  discountedPriceInr: string;
  billingType: ServiceBillingType;
  imageUrl: string;
  deliverables: string;
  exclusions: string;
  clientRequirements: string;
  targetAudience: string;
  deliveryTimeline: string;
  faqs: { question: string; answer: string }[];
  catalogueBadge: ServiceCatalogueBadge | null;
  quantitySupported: boolean;
  status: 'draft' | 'published';
}

interface ServiceEnquiryRecord {
  id: string;
  requestReference: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerBusinessName: string;
  serviceInterest: string;
  selectedPackages: {
    title: string;
    packageCode: string;
    priceInr: number;
    originalPriceInr?: number;
    discountedPriceInr?: number | null;
    billingType: ServiceBillingType;
    quantity: number;
  }[];
  requestNote: string;
  status: 'received' | 'in_progress' | 'closed';
  createdAt: string;
}

const emptyForm: PackageForm = {
  slug: '',
  categoryId: '',
  packageCode: '',
  title: '',
  category: '',
  packageKind: 'service',
  summary: '',
  description: '',
  priceInr: '',
  discountedPriceInr: '',
  billingType: 'one_time',
  imageUrl: '',
  deliverables: '',
  exclusions: '',
  clientRequirements: '',
  targetAudience: '',
  deliveryTimeline: '',
  faqs: [],
  catalogueBadge: null,
  quantitySupported: false,
  status: 'draft',
};

const inputClass = 'min-h-11 w-full rounded-xl border border-[#33453A] bg-[#101913] px-3.5 py-2.5 text-sm text-[#EAF1EB] outline-none placeholder:text-[#76867B] focus:border-[#67D8B7] focus:ring-2 focus:ring-[#67D8B7]/15';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#286D3B] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#347E49] disabled:cursor-not-allowed disabled:opacity-50';

function listToText(values: string[]): string {
  return values.join('\n');
}

function textToList(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function formFromPackage(item: ServicePackage): PackageForm {
  return {
    slug: item.slug,
    categoryId: item.categoryId || '',
    packageCode: item.packageCode,
    title: item.title,
    category: item.category,
    packageKind: item.packageKind,
    summary: item.summary,
    description: item.description,
    priceInr: String(item.priceInr),
    discountedPriceInr: item.discountedPriceInr == null ? '' : String(item.discountedPriceInr),
    billingType: item.billingType,
    imageUrl: item.imageUrl,
    deliverables: listToText(item.deliverables),
    exclusions: listToText(item.exclusions),
    clientRequirements: listToText(item.clientRequirements),
    targetAudience: item.targetAudience,
    deliveryTimeline: item.deliveryTimeline,
    faqs: item.faqs,
    catalogueBadge: item.catalogueBadge,
    quantitySupported: item.quantitySupported,
    status: item.status,
  };
}

interface CategoryDraft {
  id?: string;
  name: string;
  slug: string;
  description: string;
  displayOrder: string;
  active: boolean;
  showInCatalogue: boolean;
}

const emptyCategoryDraft: CategoryDraft = {
  name: '',
  slug: '',
  description: '',
  displayOrder: '0',
  active: true,
  showInCatalogue: true,
};

async function readApi<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin', ...init });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Could not reach the Service Store API. Check that the NearGrow Ads server is running, then retry.');
    }
    throw error;
  }
  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    throw new Error(`The Service Store API returned an invalid response (${response.status}).`);
  }
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : `Request failed (${response.status}).`);
  return body as T;
}

export function AdminServiceStore({
  onBack,
  canCreate,
  canEdit,
  canDelete,
  canPublish,
  isPrimaryOwner,
}: {
  onBack: () => void;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPublish: boolean;
  isPrimaryOwner: boolean;
}) {
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [categories, setCategories] = useState<ServiceCatalogueCategory[]>([]);
  const [enquiries, setEnquiries] = useState<ServiceEnquiryRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'packages' | 'categories' | 'enquiries' | 'orders' | 'payments' | 'storeSettings'>('packages');
  const [loading, setLoading] = useState(true);
  const [packagesLoadError, setPackagesLoadError] = useState('');
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoriesError, setCategoriesError] = useState('');
  const [loadingEnquiries, setLoadingEnquiries] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<ServicePackage | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<PackageForm>(emptyForm);
  const [slugManuallyCustomized, setSlugManuallyCustomized] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [categorySlugManuallyCustomized, setCategorySlugManuallyCustomized] = useState(false);
  const [categoryFormError, setCategoryFormError] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryFormInline, setCategoryFormInline] = useState(false);
  const [categoryReturnToTab, setCategoryReturnToTab] = useState<'packages' | 'categories'>('categories');

  const loadPackages = useCallback(async () => {
    setLoading(true);
    setError('');
    setPackagesLoadError('');
    try {
      const result = await readApi<{ packages: ServicePackage[] }>('/api/admin/service-packages');
      setPackages(result.packages);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'The Service Store could not be loaded.';
      setPackagesLoadError(message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPackages(); }, [loadPackages]);

  const loadCategories = useCallback(async () => {
    setLoadingCategories(true);
    setCategoriesError('');
    try {
      const result = await readApi<{ categories: ServiceCatalogueCategory[] }>('/api/admin/service-categories');
      if (!Array.isArray(result.categories)) throw new Error('The catalogue categories response was incomplete.');
      setCategories(result.categories);
    } catch (loadError) {
      setCategoriesError(loadError instanceof Error ? loadError.message : 'Catalogue categories could not be loaded.');
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  useEffect(() => { void loadCategories(); }, [loadCategories]);

  const loadEnquiries = useCallback(async () => {
    setLoadingEnquiries(true);
    setError('');
    try {
      const result = await readApi<{ enquiries: ServiceEnquiryRecord[] }>('/api/admin/service-enquiries');
      setEnquiries(result.enquiries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Service enquiries could not be loaded.');
    } finally {
      setLoadingEnquiries(false);
    }
  }, []);

  const openEnquiries = () => {
    setActiveTab('enquiries');
    void loadEnquiries();
  };

  const startCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm(emptyForm);
    setSlugManuallyCustomized(false);
    setCategorySearch('');
    setError('');
    setNotice('');
  };

  const startEdit = (item: ServicePackage) => {
    setEditing(item);
    setCreating(false);
    setForm(formFromPackage(item));
    setSlugManuallyCustomized(true);
    setCategorySearch('');
    setError('');
    setNotice('');
  };

  const closeForm = () => {
    setEditing(null);
    setCreating(false);
    setForm(emptyForm);
    setCategorySearch('');
  };

  const updateForm = <K extends keyof PackageForm>(key: K, value: PackageForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const packageSlugFor = (name: string) => {
    const base = serviceCatalogueSlug(name);
    if (!base) return '';
    const used = new Set(packages.filter((item) => item.id !== editing?.id).map((item) => item.slug));
    return uniqueServiceCatalogueSlug(base, used);
  };

  const openCategoryForm = (inline: boolean, category?: ServiceCatalogueCategory) => {
    setCategoryFormInline(inline);
    setCategoryReturnToTab(activeTab === 'categories' ? 'categories' : 'packages');
    setCategoryFormError('');
    setCategorySlugManuallyCustomized(Boolean(category));
    setCategoryDraft(category ? {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      displayOrder: String(category.displayOrder),
      active: category.active,
      showInCatalogue: category.showInCatalogue,
    } : {
      ...emptyCategoryDraft,
      displayOrder: String(categories.length ? Math.max(...categories.map((item) => item.displayOrder)) + 1 : 0),
    });
  };

  const saveCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryDraft) return;
    setCategoryBusy(true);
    setCategoryFormError('');
    const payload = {
      name: normalizeCatalogueCategoryName(categoryDraft.name),
      slug: serviceCatalogueSlug(categoryDraft.slug),
      description: categoryDraft.description.trim(),
      displayOrder: Number(categoryDraft.displayOrder),
      active: categoryDraft.active,
      showInCatalogue: categoryDraft.showInCatalogue,
    };
    try {
      const result = await readApi<{ category: ServiceCatalogueCategory }>(
        categoryDraft.id
          ? `/api/admin/service-categories/${encodeURIComponent(categoryDraft.id)}`
          : '/api/admin/service-categories',
        {
          method: categoryDraft.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      await loadCategories();
      if (categoryFormInline) {
        setForm((current) => ({ ...current, categoryId: result.category.id, category: result.category.name }));
        setCategorySearch('');
      } else {
        setNotice(`Category ${categoryDraft.id ? 'updated' : 'created'} successfully.`);
      }
      setCategoryDraft(null);
    } catch (saveError) {
      setCategoryFormError(saveError instanceof Error ? saveError.message : 'The category could not be saved.');
    } finally {
      setCategoryBusy(false);
    }
  };

  const deleteCategory = async (category: ServiceCatalogueCategory) => {
    if (category.packageCount && category.packageCount > 0) {
      setError(`${category.name} has ${category.packageCount} assigned ${category.packageCount === 1 ? 'package' : 'packages'}. Reassign them or archive the category instead.`);
      return;
    }
    if (!window.confirm(`Delete "${category.name}"?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await readApi(`/api/admin/service-categories/${encodeURIComponent(category.id)}`, { method: 'DELETE' });
      await loadCategories();
      setNotice('Category deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'The category could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const savePackage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const requestedStatus = submitter instanceof HTMLButtonElement
      ? submitter.value === 'published' ? 'published' : 'draft'
      : form.status;
    if (requestedStatus === 'published' && !canPublish && (!editing || editing.status !== 'published')) {
      setError('Publish permission is required to publish a package.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const payload = {
      ...form,
      slug: editing ? serviceCatalogueSlug(form.slug) : uniqueServiceCatalogueSlug(
        form.slug || form.title,
        new Set(packages.map((item) => item.slug)),
      ),
      category: categories.find((item) => item.id === form.categoryId)?.name || form.category,
      status: requestedStatus,
      featured: form.catalogueBadge === 'featured',
      priceInr: Number(form.priceInr),
      discountedPriceInr: form.discountedPriceInr.trim() ? Number(form.discountedPriceInr) : null,
      deliverables: textToList(form.deliverables),
      exclusions: textToList(form.exclusions),
      clientRequirements: textToList(form.clientRequirements),
    };
    try {
      if (editing) {
        const result = await readApi<{ package: ServicePackage }>(`/api/admin/service-packages/${encodeURIComponent(editing.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setNotice(result.package.status === 'published' ? 'Published package updated.' : 'Draft saved.');
      } else {
        const result = await readApi<{ package: ServicePackage }>('/api/admin/service-packages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setNotice(result.package.status === 'published' ? 'Package published.' : 'Draft saved.');
      }
      closeForm();
      await loadPackages();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The package could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const result = await uploadAdminMedia({ purpose: 'service-store', file, fileName: file.name });
      updateForm('imageUrl', result.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The image could not be uploaded.');
    } finally {
      setBusy(false);
    }
  };

  const deletePackage = async (item: ServicePackage) => {
    if (!window.confirm(`Delete "${item.title}" from the Service Store? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await readApi(`/api/admin/service-packages/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      setNotice('Service package deleted.');
      await loadPackages();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'The package could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, key: keyof PackageForm, options: { required?: boolean; type?: string; placeholder?: string } = {}) => (
    <label className="block text-xs font-medium text-[#B8C7BC]">
      {label}
      <input
        className={`${inputClass} mt-1.5`}
        type={options.type || 'text'}
        required={options.required}
        min={options.type === 'number' ? '0' : undefined}
        step={options.type === 'number' ? '0.01' : undefined}
        value={String(form[key])}
        placeholder={options.placeholder}
        onChange={(event) => updateForm(key, (options.type === 'number' ? event.target.value : event.target.value) as PackageForm[typeof key])}
      />
    </label>
  );

  return (
    <div className="admin-service-store space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#33453A] px-3 text-xs font-semibold text-[#C8D4CB] hover:bg-white/5">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </button>
        {activeTab === 'packages' && canCreate && !creating && !editing && <button type="button" onClick={startCreate} className={buttonClass}><PackagePlus className="h-4 w-4" /> Add Service Package</button>}
        {activeTab === 'categories' && canCreate && <button type="button" onClick={() => openCategoryForm(false)} className={buttonClass}><Plus className="h-4 w-4" /> Add Category</button>}
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">{notice}</div>}

      <div className="flex flex-wrap gap-2 border-b border-[#304135] pb-3">
        <button type="button" onClick={() => setActiveTab('packages')} aria-pressed={activeTab === 'packages'} className={`min-h-10 rounded-xl px-4 text-xs font-semibold ${activeTab === 'packages' ? 'bg-[#286D3B] text-white' : 'border border-[#33453A] text-[#C8D4CB]'}`}>Packages</button>
        <button type="button" onClick={() => { setActiveTab('categories'); void loadCategories(); }} aria-pressed={activeTab === 'categories'} className={`min-h-10 rounded-xl px-4 text-xs font-semibold ${activeTab === 'categories' ? 'bg-[#286D3B] text-white' : 'border border-[#33453A] text-[#C8D4CB]'}`}>Categories</button>
        <button type="button" onClick={openEnquiries} aria-pressed={activeTab === 'enquiries'} className={`min-h-10 rounded-xl px-4 text-xs font-semibold ${activeTab === 'enquiries' ? 'bg-[#286D3B] text-white' : 'border border-[#33453A] text-[#C8D4CB]'}`}>Enquiry Requests</button>
        <button type="button" onClick={() => setActiveTab('orders')} aria-pressed={activeTab === 'orders'} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-semibold ${activeTab === 'orders' ? 'bg-[#286D3B] text-white' : 'border border-[#33453A] text-[#C8D4CB]'}`}><ShoppingBag className="h-3.5 w-3.5" /> Orders &amp; Fulfilment</button>
        {isPrimaryOwner && <>
          <button type="button" onClick={() => setActiveTab('payments')} aria-pressed={activeTab === 'payments'} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-semibold ${activeTab === 'payments' ? 'bg-[#286D3B] text-white' : 'border border-[#33453A] text-[#C8D4CB]'}`}><CreditCard className="h-3.5 w-3.5" /> Payments &amp; Gateway</button>
          <button type="button" onClick={() => setActiveTab('storeSettings')} aria-pressed={activeTab === 'storeSettings'} className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-semibold ${activeTab === 'storeSettings' ? 'bg-[#286D3B] text-white' : 'border border-[#33453A] text-[#C8D4CB]'}`}><Settings2 className="h-3.5 w-3.5" /> Store Settings</button>
        </>}
      </div>

      {activeTab === 'orders' && <AdminServiceOrders canEdit={canEdit} />}

      {activeTab === 'payments' && isPrimaryOwner && <section className="space-y-4 rounded-2xl border border-[#304135] bg-[#19241D] p-5 sm:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8DD39D]">Razorpay integration</p>
          <h2 className="mt-2 text-lg font-bold text-[#ECF3EE]">Payments &amp; Gateway</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#A9B8AD]">Only Razorpay Test mode is implemented. Live transactions and direct UPI are intentionally unavailable; Test payments never route real funds.</p>
        </div>
        <button type="button" onClick={() => setActiveTab('storeSettings')} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#286D3B] px-4 text-xs font-semibold text-white">Open Store Settings <Settings2 className="h-4 w-4" /></button>
      </section>}

      {activeTab === 'storeSettings' && isPrimaryOwner && <section className="space-y-4">
        <div className="rounded-2xl border border-[#304135] bg-[#19241D] p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8DD39D]">Store Settings</p>
          <h2 className="mt-1 text-lg font-bold text-[#ECF3EE]">Payment Receiving</h2>
        </div>
        <AdminPaymentReceiving />
      </section>}

      {activeTab === 'categories' && <section className="overflow-hidden rounded-2xl border border-[#304135] bg-[#19241D]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#304135] p-5">
          <div><h2 className="font-semibold text-[#ECF3EE]">Catalogue categories</h2><p className="mt-1 text-xs text-[#A9B8AD]">Manage categories shown in the public Catalogue. Blog categories remain separate.</p></div>
          <button type="button" onClick={() => void loadCategories()} disabled={loadingCategories} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[#33453A] px-3 text-xs text-[#C8D4CB] disabled:opacity-50">{loadingCategories ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Refresh</button>
        </div>
        {categoriesError
          ? <div className="p-6 text-sm text-rose-200">{categoriesError} <button type="button" onClick={() => void loadCategories()} className="underline">Retry</button></div>
          : loadingCategories
            ? <p className="p-8 text-center text-sm text-[#A9B8AD]">Loading catalogue categories…</p>
            : categories.length === 0
              ? <p className="p-8 text-center text-sm text-[#A9B8AD]">No catalogue categories yet. Add a category before creating a package.</p>
              : <div className="divide-y divide-[#304135]">
                {categories.map((category) => (
                  <article key={category.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-[#ECF3EE]">{category.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${category.active ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>{category.active ? 'Active' : 'Archived'}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${category.showInCatalogue ? 'bg-sky-400/10 text-sky-200' : 'bg-white/5 text-[#A9B8AD]'}`}>{category.showInCatalogue ? 'Shown in Catalogue' : 'Hidden from Catalogue'}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-[#A9B8AD]">/{category.slug} · Order {category.displayOrder} · {category.packageCount || 0} assigned {category.packageCount === 1 ? 'package' : 'packages'}</p>
                      {category.description && <p className="mt-1 text-xs text-[#91A195]">{category.description}</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {canEdit && <button type="button" onClick={() => openCategoryForm(false, category)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#33453A] px-3 text-xs text-[#C8D4CB] hover:bg-white/5"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
                      {canDelete && <button type="button" onClick={() => void deleteCategory(category)} disabled={busy} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-400/20 px-3 text-xs text-rose-200 hover:bg-rose-950/25 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
                    </div>
                  </article>
                ))}
              </div>}
      </section>}

      {activeTab === 'packages' && (creating || editing) && (
        <form onSubmit={(event) => void savePackage(event)} className="admin-service-store-editor space-y-5 rounded-2xl border border-[#304135] bg-[#19241D] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-[#ECF3EE]">{editing ? 'Edit service package' : 'Create service package'}</h2>
              <p className="mt-1 text-xs text-[#A9B8AD]">Status: <span className={form.status === 'published' ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-200'}>{form.status === 'published' ? 'Published' : 'Draft'}</span>. Only published packages appear in the public Catalogue.</p>
            </div>
            <button type="button" onClick={closeForm} aria-label="Close package form" className="rounded-lg p-2 text-[#A9B8AD] hover:bg-white/5"><X className="h-4 w-4" /></button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-medium text-[#B8C7BC]">Package name
              <input className={`${inputClass} mt-1.5`} required maxLength={160} value={form.title} onChange={(event) => {
                const title = event.target.value;
                setForm((current) => ({
                  ...current,
                  title,
                  ...(!editing && !slugManuallyCustomized ? { slug: packageSlugFor(title) } : {}),
                }));
              }} />
            </label>
            <label className="block text-xs font-medium text-[#B8C7BC]">Package URL slug
              <input className={`${inputClass} mt-1.5`} required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={form.slug} placeholder="google-maps-optimization-sprint" onChange={(event) => {
                setSlugManuallyCustomized(true);
                updateForm('slug', serviceCatalogueSlug(event.target.value));
              }} />
              <span className="mt-1.5 block break-all text-[11px] text-[#8EA093]">URL: {typeof window === 'undefined' ? '' : window.location.origin}/catalogue/{form.slug || 'your-package-slug'}</span>
            </label>
            {field('Package code (optional)', 'packageCode')}
            <div className="block text-xs font-medium text-[#B8C7BC]">
              <label htmlFor="service-package-category-search">Category</label>
              {categoriesError
                ? <div className="mt-1.5 rounded-xl border border-rose-400/30 bg-rose-950/20 p-3 text-xs text-rose-200">{categoriesError} <button type="button" onClick={() => void loadCategories()} className="ml-1 underline">Retry</button></div>
                : categories.length === 0 && !loadingCategories
                  ? <div className="mt-1.5 rounded-xl border border-[#33453A] p-3 text-xs text-[#A9B8AD]">No catalogue categories yet. Create your first category to assign this package.</div>
                  : <>
                    <input id="service-package-category-search" className={`${inputClass} mt-1.5`} value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder="Search saved categories…" disabled={loadingCategories} />
                    <select className={`${inputClass} mt-2`} required value={form.categoryId} disabled={loadingCategories || !categories.length} onChange={(event) => {
                      const category = categories.find((item) => item.id === event.target.value);
                      setForm((current) => ({ ...current, categoryId: category?.id || '', category: category?.name || '' }));
                    }}>
                      <option value="">{loadingCategories ? 'Loading categories…' : 'Select a saved category'}</option>
                      {categories.filter((item) => item.active || item.id === form.categoryId)
                        .filter((item) => item.name.toLowerCase().includes(categorySearch.trim().toLowerCase()))
                        .map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (archived)'}</option>)}
                    </select>
                  </>}
              {canCreate && <button type="button" onClick={() => openCategoryForm(true)} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#8DD39D] hover:text-white">+ Add category</button>}
              {canCreate && categories.length === 0 && !loadingCategories && !categoriesError && <button type="button" onClick={() => openCategoryForm(true)} className="ml-3 mt-2 text-xs font-semibold text-[#8DD39D] underline underline-offset-2">Create your first category</button>}
            </div>
            <label className="block text-xs font-medium text-[#B8C7BC]">Offering type
              <select className={`${inputClass} mt-1.5`} value={form.packageKind} onChange={(event) => updateForm('packageKind', event.target.value as ServicePackageKind)}>
                <option value="service">Service package</option><option value="add_on">Add-on</option>
              </select>
            </label>
            {field('Price in INR', 'priceInr', { required: true, type: 'number' })}
            {field('Discounted price in INR (optional)', 'discountedPriceInr', { type: 'number', placeholder: 'Leave blank to use the regular price' })}
            <label className="block text-xs font-medium text-[#B8C7BC]">Billing frequency
              <select className={`${inputClass} mt-1.5`} value={form.billingType} onChange={(event) => updateForm('billingType', event.target.value as ServiceBillingType)}>
                {Object.entries(billingTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {field('Short factual summary', 'summary', { required: true })}
            {field('Target audience (optional)', 'targetAudience')}
            {field('Delivery timeline (only if defined)', 'deliveryTimeline')}
          </div>

          <label className="block text-xs font-medium text-[#B8C7BC]">Full description
            <textarea className={`${inputClass} mt-1.5 min-h-24`} value={form.description} onChange={(event) => updateForm('description', event.target.value)} />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            {([
              ['Included deliverables', 'deliverables'],
              ['Exclusions', 'exclusions'],
              ['Client requirements', 'clientRequirements'],
            ] as const).map(([label, key]) => (
              <label key={key} className="block text-xs font-medium text-[#B8C7BC]">{label} (one per line)
                <textarea className={`${inputClass} mt-1.5 min-h-28`} value={form[key]} onChange={(event) => updateForm(key, event.target.value)} />
              </label>
            ))}
          </div>

          <div className="space-y-3 rounded-xl border border-[#33453A] p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-[#D8E2DA]">Frequently asked questions</h3>
              <button type="button" onClick={() => updateForm('faqs', [...form.faqs, { question: '', answer: '' }])} className="text-xs font-semibold text-[#8DD39D]">Add FAQ</button>
            </div>
            {form.faqs.map((faq, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
                <input className={inputClass} aria-label={`FAQ ${index + 1} question`} placeholder="Question" value={faq.question} onChange={(event) => updateForm('faqs', form.faqs.map((item, itemIndex) => itemIndex === index ? { ...item, question: event.target.value } : item))} />
                <input className={inputClass} aria-label={`FAQ ${index + 1} answer`} placeholder="Answer" value={faq.answer} onChange={(event) => updateForm('faqs', form.faqs.map((item, itemIndex) => itemIndex === index ? { ...item, answer: event.target.value } : item))} />
                <button type="button" aria-label={`Remove FAQ ${index + 1}`} onClick={() => updateForm('faqs', form.faqs.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg p-2 text-rose-300 hover:bg-rose-950/30"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-medium text-[#B8C7BC]">Package image URL
              <input className={`${inputClass} mt-1.5`} value={form.imageUrl} onChange={(event) => updateForm('imageUrl', event.target.value)} placeholder="https://…" />
            </label>
            <label className="block text-xs font-medium text-[#B8C7BC]">Or upload an image
              <span className="mt-1.5 flex min-h-11 items-center gap-2 rounded-xl border border-[#33453A] bg-[#101913] px-3 text-xs text-[#A9B8AD]">
                <ImagePlus className="h-4 w-4 shrink-0" />
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => void uploadImage(event.target.files?.[0])} className="min-w-0 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-[#286D3B] file:px-3 file:py-1.5 file:text-white" />
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-[#C6D2C8]">
            <label className="flex items-center gap-2">
              <span>Catalogue badge</span>
              <select className="rounded-lg border border-[#33453A] bg-[#101913] px-2 py-1.5" value={form.catalogueBadge ?? ''} onChange={(event) => updateForm('catalogueBadge', event.target.value ? event.target.value as ServiceCatalogueBadge : null)}>
                <option value="">No badge</option><option value="featured">Featured</option><option value="recommended">Recommended</option><option value="most_popular">Most Popular</option>
              </select>
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.quantitySupported} onChange={(event) => updateForm('quantitySupported', event.target.checked)} /> Quantity can be selected</label>
            <span className="flex items-center gap-2"><span>Current status:</span><strong className={form.status === 'published' ? 'text-emerald-300' : 'text-amber-200'}>{form.status === 'published' ? 'Published' : 'Draft'}</strong>{!canPublish && form.status !== 'published' && <span className="text-[#91A195]">Publish permission required</span>}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="submit" name="publication" value="draft" disabled={busy || (creating ? !canCreate : !canEdit)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#33453A] px-4 py-2 text-xs font-semibold text-[#C8D4CB] transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {busy ? 'Saving…' : 'Save Draft'}
            </button>
            {(canPublish || (editing?.status === 'published' && canEdit)) && <button type="submit" name="publication" value="published" disabled={busy || (creating ? !canCreate : !canEdit)} className={buttonClass}>
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {busy ? 'Saving…' : editing?.status === 'published' ? 'Update Published Package' : 'Publish Package'}
            </button>}
            <button type="button" onClick={closeForm} disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#33453A] px-4 text-xs font-semibold text-[#C8D4CB] hover:bg-white/5">Cancel</button>
          </div>
        </form>
      )}

      {activeTab === 'packages' && <section className="overflow-hidden rounded-2xl border border-[#304135] bg-[#19241D]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#304135] p-5">
          <div><h2 className="font-semibold text-[#ECF3EE]">Service packages</h2><p className="mt-1 text-xs text-[#A9B8AD]">{packagesLoadError ? 'Package count unavailable' : `${packages.length} CMS-managed ${packages.length === 1 ? 'package' : 'packages'}`}</p></div>
          <button type="button" onClick={() => void loadPackages()} disabled={loading} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[#33453A] px-3 text-xs text-[#C8D4CB] disabled:opacity-50">{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Refresh</button>
        </div>
        {loading ? (
          <div className="space-y-3 p-5" aria-label="Loading packages">{[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-white/5" />)}</div>
        ) : packagesLoadError ? (
          <div role="alert" className="p-8 text-center text-sm text-rose-200">
            <p>{packagesLoadError}</p>
            <button type="button" onClick={() => void loadPackages()} className="mt-3 underline underline-offset-2">Retry loading packages</button>
          </div>
        ) : packages.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#A9B8AD]">No service packages yet. Add a real offering to publish it to the public Catalogue.</div>
        ) : (
          <div className="divide-y divide-[#304135]">
            {packages.map((item) => (
              <article key={item.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover" loading="lazy" /> : <div className="grid h-12 w-12 place-items-center rounded-xl bg-white/5 text-[#8DD39D]"><PackagePlus className="h-5 w-5" /></div>}
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-[#ECF3EE]">{item.title}</h3>
                    <p className="mt-1 truncate text-xs text-[#A9B8AD]">{item.category} · {item.discountedPriceInr != null ? <><span className="line-through">{formatServicePrice(item.priceInr)}</span> {formatServicePrice(item.discountedPriceInr)}</> : formatServicePrice(item.priceInr)} / {billingTypeLabel[item.billingType].toLowerCase()}{item.catalogueBadge ? ` · ${item.catalogueBadge.replace('_', ' ')}` : ''}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${item.status === 'published' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200'}`}>{item.status}</span>
                </div>
                <div className="flex shrink-0 gap-2">
                  {canEdit && <button type="button" onClick={() => startEdit(item)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#33453A] px-3 text-xs text-[#C8D4CB] hover:bg-white/5"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
                  {canDelete && <button type="button" onClick={() => void deletePackage(item)} disabled={busy} aria-label={`Delete ${item.title}`} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-400/20 px-3 text-xs text-rose-200 hover:bg-rose-950/25 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>}

      {activeTab === 'enquiries' && <section className="overflow-hidden rounded-2xl border border-[#304135] bg-[#19241D]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#304135] p-5">
          <div><h2 className="font-semibold text-[#ECF3EE]">Service enquiry requests</h2><p className="mt-1 text-xs text-[#A9B8AD]">Private contact information is shown to signed-in admins with Service Store view access.</p></div>
          <button type="button" onClick={() => void loadEnquiries()} disabled={loadingEnquiries} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[#33453A] px-3 text-xs text-[#C8D4CB] disabled:opacity-50">{loadingEnquiries ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Refresh</button>
        </div>
        {loadingEnquiries ? <div className="space-y-3 p-5">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-white/5" />)}</div> : enquiries.length === 0 ? <p className="p-10 text-center text-sm text-[#A9B8AD]">No service enquiries have been submitted.</p> : (
          <div className="divide-y divide-[#304135]">
            {enquiries.map((enquiry) => (
              <article key={enquiry.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_1.2fr_auto] sm:items-start sm:px-5">
                <div><p className="text-xs font-bold text-[#ECF3EE]">{enquiry.requestReference}</p><p className="mt-1 text-[11px] text-[#A9B8AD]">{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(enquiry.createdAt))}</p><span className="mt-2 inline-flex rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">{enquiry.status.replace('_', ' ')}</span></div>
                <div><p className="text-sm font-semibold text-[#ECF3EE]">{enquiry.customerName}</p>{enquiry.customerBusinessName && <p className="mt-1 text-xs text-[#A9B8AD]">{enquiry.customerBusinessName}</p>}{enquiry.customerEmail && <a href={`mailto:${encodeURIComponent(enquiry.customerEmail)}`} className="mt-1 block break-all text-xs text-[#9FD9A9] hover:underline">{enquiry.customerEmail}</a>}{enquiry.customerPhone && <a href={`tel:${encodeURIComponent(enquiry.customerPhone)}`} className="mt-1 block text-xs text-[#A9B8AD] hover:underline">{enquiry.customerPhone}</a>}</div>
                <div className="text-xs text-[#C8D4CB]"><p className="font-semibold">Selected services</p>{enquiry.serviceInterest && <p className="mt-1 text-[#9FD9A9]">{enquiry.serviceInterest}</p>}<ul className="mt-1 space-y-1">{enquiry.selectedPackages.map((item, index) => <li key={`${item.title}-${index}`}>{item.title}{item.quantity > 1 ? ` × ${item.quantity}` : ''} · {item.originalPriceInr != null && item.originalPriceInr !== item.priceInr && <span className="mr-1 line-through text-[#91A195]">{formatServicePrice(item.originalPriceInr)}</span>}{formatServicePrice(item.priceInr)} / {billingTypeLabel[item.billingType].toLowerCase()}</li>)}</ul>{enquiry.requestNote && <p className="mt-2 whitespace-pre-wrap text-[#A9B8AD]">Note: {enquiry.requestNote}</p>}</div>
                <div className="text-[10px] text-[#A9B8AD]">Enquiry only · no payment</div>
              </article>
            ))}
          </div>
        )}
      </section>}

      {categoryDraft && <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/70 p-4" role="presentation">
        <form onSubmit={(event) => void saveCategory(event)} role="dialog" aria-modal="true" aria-labelledby="service-category-form-title" className="my-auto w-full max-w-lg space-y-4 rounded-2xl border border-[#304135] bg-[#19241D] p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div><h2 id="service-category-form-title" className="font-semibold text-[#ECF3EE]">{categoryDraft.id ? 'Edit catalogue category' : 'Add catalogue category'}</h2><p className="mt-1 text-xs text-[#A9B8AD]">This category belongs to the public Service Store Catalogue.</p></div>
            <button type="button" onClick={() => { setCategoryDraft(null); setActiveTab(categoryReturnToTab); }} aria-label="Close category form" className="rounded-lg p-2 text-[#A9B8AD] hover:bg-white/5"><X className="h-4 w-4" /></button>
          </div>
          {categoryFormError && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">{categoryFormError}</p>}
          <label className="block text-xs font-medium text-[#B8C7BC]">Category name
            <input required maxLength={100} className={`${inputClass} mt-1.5`} value={categoryDraft.name} onChange={(event) => {
              const name = event.target.value;
              setCategoryDraft((current) => current ? {
                ...current,
                name,
                ...(!categorySlugManuallyCustomized ? { slug: serviceCatalogueSlug(name) } : {}),
              } : current);
            }} />
          </label>
          <label className="block text-xs font-medium text-[#B8C7BC]">Category slug
            <input required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" className={`${inputClass} mt-1.5`} value={categoryDraft.slug} onChange={(event) => {
              setCategorySlugManuallyCustomized(true);
              setCategoryDraft((current) => current ? { ...current, slug: serviceCatalogueSlug(event.target.value) } : current);
            }} />
            <span className="mt-1 block text-[11px] text-[#91A195]">Used as the managed category identifier; package assignments use the stable category ID.</span>
          </label>
          <label className="block text-xs font-medium text-[#B8C7BC]">Description (optional)
            <textarea maxLength={500} rows={3} className={`${inputClass} mt-1.5`} value={categoryDraft.description} onChange={(event) => setCategoryDraft((current) => current ? { ...current, description: event.target.value } : current)} />
          </label>
          <label className="block text-xs font-medium text-[#B8C7BC]">Display order
            <input required type="number" min="0" max="10000" step="1" className={`${inputClass} mt-1.5`} value={categoryDraft.displayOrder} onChange={(event) => setCategoryDraft((current) => current ? { ...current, displayOrder: event.target.value } : current)} />
          </label>
          <div className="flex flex-wrap gap-5 text-xs text-[#C8D4CB]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={categoryDraft.active} onChange={(event) => setCategoryDraft((current) => current ? { ...current, active: event.target.checked } : current)} /> Active</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={categoryDraft.showInCatalogue} onChange={(event) => setCategoryDraft((current) => current ? { ...current, showInCatalogue: event.target.checked } : current)} /> Show in Catalogue</label>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={categoryBusy || (categoryDraft.id ? !canEdit : !canCreate)} className={buttonClass}>{categoryBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{categoryBusy ? 'Saving…' : 'Save category'}</button>
            <button type="button" disabled={categoryBusy} onClick={() => { setCategoryDraft(null); setActiveTab(categoryReturnToTab); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#33453A] px-4 text-xs font-semibold text-[#C8D4CB] hover:bg-white/5">Cancel</button>
          </div>
        </form>
      </div>}
    </div>
  );
}
