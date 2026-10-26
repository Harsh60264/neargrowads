import { useEffect, useMemo, useState } from 'react';
import { resolveBlogImage, type BlogPost } from '../../data/blogData';
import type { PublicImageTheme } from '../../data/themeImages';
import { ArrowLeft, ArrowRight, ArrowUpRight, CheckCircle2, Clock, User } from 'lucide-react';
import { HeroOrbitBackground } from '../ui/HeroOrbitBackground';
import { DEFAULT_SITE_CONTENT, type SiteContent } from '../../data/siteContent';
import { publicText } from '../../data/publicCopy';

interface BlogIndexPageProps {
  onNavigate: (path: string) => void;
  posts: BlogPost[];
  siteContent?: SiteContent;
  theme: PublicImageTheme;
}

const ARTICLES_PER_PAGE = 5;

function publishedLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function ArticleMeta({ post, compact = false }: { post: BlogPost; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-xs ${compact ? 'text-white/55' : 'text-white/60'}`}>
      <span className="font-semibold text-[#8FE1A0]">      {post.category}</span>
      <span aria-hidden="true" className="text-white/25">/</span>
      <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{post.readTime}</span>
      <span aria-hidden="true" className="text-white/25">/</span>
      <span>{publishedLabel(post.publishedDate)}</span>
    </div>
  );
}

export const BlogIndexPage = ({ onNavigate, posts, siteContent = DEFAULT_SITE_CONTENT, theme }: BlogIndexPageProps) => {
  const text = (key: string) => publicText(siteContent.copy, key);
  const [activeCategory, setActiveCategory] = useState('All insights');
  const [currentPage, setCurrentPage] = useState(1);
  const [featured, ...remaining] = posts;
  const categories = useMemo(() => ['All insights', ...new Set(posts.map((post) => post.category.trim()).filter(Boolean))], [posts]);
  const filteredPosts = useMemo(
    () => activeCategory === 'All insights' ? remaining : remaining.filter((post) => post.category === activeCategory),
    [activeCategory, remaining],
  );
  const featuredMatches = !featured || activeCategory === 'All insights' || featured.category === activeCategory;
  const visibleArticleCount = filteredPosts.length + (featured && featuredMatches ? 1 : 0);
  const categoryCounts = useMemo(
    () => new Map<string, number>(categories.map((category) => [
      category,
      category === 'All insights' ? posts.length : posts.filter((post) => post.category === category).length,
    ])),
    [categories, posts],
  );
  const pageCount = Math.ceil(filteredPosts.length / ARTICLES_PER_PAGE);
  const pagePosts = useMemo(
    () => filteredPosts.slice((currentPage - 1) * ARTICLES_PER_PAGE, currentPage * ARTICLES_PER_PAGE),
    [currentPage, filteredPosts],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory]);

  useEffect(() => {
    if (currentPage > pageCount && pageCount > 0) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  const openArticle = (slug: string) => onNavigate(`/blog/${encodeURIComponent(slug)}`);

  return (
    <div className="blog-index-page min-h-screen overflow-hidden bg-[#080E16] text-white">
      <section className="relative isolate overflow-hidden border-b border-white/[0.06]">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_75%_0%,rgba(0,138,85,0.17),transparent_45%),linear-gradient(180deg,#0B1420_0%,#080E16_100%)]" />
        <HeroOrbitBackground ambient />
        <div className="relative z-10 mx-auto max-w-7xl px-4 pb-12 pt-16 sm:px-6 sm:pb-16 sm:pt-20 lg:px-8 lg:pb-20 lg:pt-24">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#8FE1A0]">
              <span className="h-px w-7 bg-[#45A849]" /> {text('blog.hero.eyebrow')}
            </div>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-white [text-wrap:balance] sm:text-5xl lg:text-6xl">
              {text('blog.hero.headlineBefore')} <span className="text-[#8FE1A0]">{text('blog.hero.headlineHighlight')}</span>
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-white/60 sm:text-base">
              {text('blog.hero.description')}
            </p>
          </div>
          <div className="mt-10 flex gap-2 overflow-x-auto pb-2 sm:mt-12 sm:flex-wrap sm:overflow-visible">
            {categories.map((category) => {
              const selected = activeCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveCategory(category)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7] ${selected
                    ? 'border-[#67D8B7]/50 bg-[#67D8B7]/10 text-[#B6F1DF]'
                    : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:text-white'}`}
                >
                  {category}
                  <span className={`text-[10px] ${selected ? 'text-[#8FE1A0]' : 'text-white/35'}`}>{categoryCounts.get(category)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16 lg:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {featured && featuredMatches && (
            <article className="group relative isolate mb-8 grid min-h-[380px] overflow-hidden rounded-3xl border border-white/10 bg-[#101A2A] shadow-[0_24px_80px_rgba(0,0,0,0.24)] transition-colors hover:border-[#67D8B7]/40 lg:mb-10 lg:min-h-[440px] lg:grid-cols-[1.02fr_0.98fr]">
              <div className="relative order-2 flex flex-col justify-center p-6 sm:p-8 lg:order-1 lg:p-12 xl:p-14">
                <span className="mb-5 inline-flex w-fit items-center rounded-full border border-[#F5A623]/25 bg-[#F5A623]/[0.08] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#F5C46E]">
                  {text('blog.featured.label')}
                </span>
                <ArticleMeta post={featured} />
                <h2 className="mt-5 text-2xl font-bold leading-tight tracking-tight text-white [text-wrap:balance] transition-colors group-hover:text-[#D9F8EA] sm:text-3xl lg:text-4xl">
                  {featured.title}
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-7 text-white/60 sm:text-base">{featured.excerpt}</p>
                <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
                  <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-white/65">
                    <User className="h-4 w-4 shrink-0 text-[#8FE1A0]" />
                    <span className="truncate">{featured.author.name}</span>
                  </span>
                  <button type="button" onClick={() => openArticle(featured.slug)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#45A849] px-5 text-xs font-bold text-black transition-colors hover:bg-[#378E3B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]">
                    {text('blog.featured.cta')} <ArrowUpRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <button type="button" onClick={() => openArticle(featured.slug)} aria-label={`Read ${featured.title}`} className="relative order-1 min-h-56 overflow-hidden bg-[#0C1820] text-left lg:order-2 lg:min-h-full">
                {resolveBlogImage(featured.featuredImage, featured.featuredImageAltText ?? '', featured.featuredImageVariants, theme).image.url ? (
                  <img src={resolveBlogImage(featured.featuredImage, featured.featuredImageAltText ?? '', featured.featuredImageVariants, theme).image.url} alt={resolveBlogImage(featured.featuredImage, featured.featuredImageAltText ?? '', featured.featuredImageVariants, theme).image.altText ?? ''} fetchPriority="high" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.035]" />
                ) : (
                  <div aria-hidden="true" className="blog-fallback-featured absolute inset-0 bg-[radial-gradient(ellipse_at_68%_38%,rgba(103,216,183,0.2),transparent_36%),radial-gradient(ellipse_at_25%_80%,rgba(245,166,35,0.12),transparent_38%),linear-gradient(135deg,#0D1B28,#07111B)]">
                    <div className="absolute inset-8 rounded-2xl border border-white/10 sm:inset-12">
                      <div className="absolute inset-x-8 top-1/2 h-px bg-gradient-to-r from-transparent via-[#67D8B7]/50 to-transparent" />
                      <div className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#67D8B7]/20 shadow-[0_0_70px_rgba(103,216,183,0.12)]" />
                      <div className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#67D8B7]/30" />
                      <span className="absolute bottom-5 left-5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/45 sm:bottom-7 sm:left-7">NearGrow field notes</span>
                    </div>
                  </div>
                )}
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#07111B]/45 via-transparent to-transparent" />
                <span className="absolute bottom-5 right-5 grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-[#07111B]/55 text-white backdrop-blur-sm transition-transform group-hover:translate-x-1 group-hover:-translate-y-1">
                  <ArrowUpRight className="h-5 w-5" />
                </span>
              </button>
            </article>
          )}

          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8FE1A0]">Explore the journal</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {activeCategory === 'All insights' ? 'More perspectives for what’s next.' : `${activeCategory} insights`}
              </h2>
            </div>
            <span className="text-xs text-white/70">{visibleArticleCount} {visibleArticleCount === 1 ? 'article' : 'articles'}</span>
          </div>

          {filteredPosts.length > 0 ? (
            <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
              {pagePosts.map((post, index) => (
                <div key={post.slug} className={index === 0 ? 'xl:col-span-2' : ''}>
                  <article
                    role="link"
                    tabIndex={0}
                    onClick={() => openArticle(post.slug)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openArticle(post.slug);
                      }
                    }}
                    className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0D1724] transition duration-300 hover:-translate-y-1 hover:border-[#67D8B7]/40 hover:shadow-[0_16px_48px_rgba(0,0,0,0.24),0_0_24px_rgba(103,216,183,0.07)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7]"
                  >
                    {resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.url ? (
                      <img src={resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.url} alt={resolveBlogImage(post.featuredImage, post.featuredImageAltText ?? '', post.featuredImageVariants, theme).image.altText ?? ''} loading="lazy" className="aspect-[16/8] w-full object-cover transition-transform duration-700 group-hover:scale-[1.025]" />
                    ) : (
                      <div aria-hidden="true" className={`blog-fallback-thumbnail relative aspect-[16/8] overflow-hidden bg-[radial-gradient(ellipse_at_70%_35%,rgba(0,138,85,0.22),transparent_42%),linear-gradient(135deg,#122335,#09121E)] ${index === 0 ? 'sm:aspect-[16/6]' : ''}`}>
                        <div className="absolute -bottom-16 right-8 h-48 w-48 rounded-full border border-[#67D8B7]/15" />
                        <div className="absolute -bottom-10 right-14 h-32 w-32 rounded-full border border-[#67D8B7]/20" />
                        <span className="absolute bottom-4 left-5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">{post.category}</span>
                      </div>
                    )}
                    <div className="flex flex-1 flex-col p-5 sm:p-6">
                      <ArticleMeta post={post} compact />
                      <h3 className="mt-4 text-lg font-bold leading-snug text-white transition-colors group-hover:text-[#A8EBD6] sm:text-xl">{post.title}</h3>
                      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-white/55">{post.excerpt}</p>
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-5 mt-6">
                        <span className="inline-flex min-w-0 items-center gap-2 text-xs text-white/55">
                          {resolveBlogImage(post.author.imageUrl, post.author.name, post.author.imageVariants, theme).image.url
                            ? <img src={resolveBlogImage(post.author.imageUrl, post.author.name, post.author.imageVariants, theme).image.url} alt="" loading="lazy" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                            : <User className="h-3.5 w-3.5 shrink-0 text-[#8FE1A0]" />}
                          <span className="truncate">{post.author.name}</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8FE1A0] transition-transform group-hover:translate-x-1">
                          {text('blog.article.cta')} <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </article>
                </div>
              ))}
            </div>
          ) : !featuredMatches || !featured ? (
            <div className="blog-empty-state rounded-2xl border border-white/10 bg-[#0D1724] px-6 py-14 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-[#67D8B7]" />
              <h3 className="mt-4 text-lg font-bold text-white">More articles are on the way.</h3>
              <p className="mt-2 text-sm text-white/55">Choose another topic to explore the latest growth insights.</p>
            </div>
          ) : null}
          {pageCount > 1 && (
            <nav aria-label="Blog pages" className="mt-10 flex flex-wrap items-center justify-center gap-2">
              <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/70 transition hover:border-[#67D8B7]/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-35">
                <ArrowLeft className="h-4 w-4" /> Previous
              </button>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
                <button key={page} type="button" aria-label={`Page ${page}`} aria-current={currentPage === page ? 'page' : undefined} onClick={() => setCurrentPage(page)} className={`grid h-10 min-w-10 place-items-center rounded-xl border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67D8B7] ${currentPage === page ? 'border-[#67D8B7]/50 bg-[#67D8B7]/10 text-[#B6F1DF]' : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white'}`}>
                  {page}
                </button>
              ))}
              <button type="button" onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))} disabled={currentPage === pageCount} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/70 transition hover:border-[#67D8B7]/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-35">
                Next <ArrowRight className="h-4 w-4" />
              </button>
            </nav>
          )}
        </div>
      </section>
    </div>
  );
};
