import { fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { load as loadCheerio } from 'cheerio';
import { NovelStatus } from '@libs/novelStatus';
import dayjs from 'dayjs';

class FictionZonePlugin implements Plugin.PluginBase {
  id = 'fictionzone';
  name = 'Fiction Zone';
  icon = 'src/en/fictionzone/icon.png';
  site = 'https://fictionzone.net';
  version = '1.0.5';
  // No filters currently (tag filters removed per request)
  imageRequestInit?: Plugin.ImageRequestInit | undefined = undefined;

  //flag indicates whether access to LocalStorage, SesesionStorage is required.
  webStorageUtilized?: boolean;

  cachedNovelIds: Map<string, string> = new Map();

  async popularNovels(
    pageNo: number,
    _options: Plugin.PopularNovelsOptions<any>,
  ): Promise<Plugin.NovelItem[]> {
    // Use API newest sort. Fallback to HTML if API fails.
    try {
      const res = await fetchApi(this.site + '/api/__api_party/api-v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/novel',
          query: { page: pageNo, sort: 'newest' },
          headers: { 'content-type': 'application/json' },
          method: 'get',
        }),
      });
      const json = await res.json();
      if (json?._success && Array.isArray(json._data)) {
        return json._data.map((n: any) => {
          const slug: string = n?.slug;
          const title: string = n?.title || slug?.replace(/[-_]/g, ' ');
          const image: string | undefined = n?.image;
          let cover: string | undefined = undefined;
          if (image) {
            if (image.startsWith('http')) cover = image;
            else if (image.includes('novel_covers/')) {
              const file = image.split('novel_covers/').pop();
              if (file) cover = `https://cdn.fictionzone.net/insecure/rs:force:160:240:0/q:90/plain/local:///novel_covers/${file}@webp`;
              if (!cover) cover = `${this.site}/${image.startsWith('novel_covers/') ? 'storage/' + image : image}`;
            } else cover = `${this.site}/${image.replace(/^\//, '')}`;
          }
          return { name: title, path: `novel/${slug}`, cover, author: n?.author_name || undefined } as Plugin.NovelItem;
        });
      }
    } catch {}
    return await this.getPage(this.site + '/library?page=' + pageNo);
  }

  async getPage(url: string) {
    const req = await fetchApi(url);
    const body = await req.text();
    const loadedCheerio = loadCheerio(body);

    return loadedCheerio('div.novel-card')
      .map((i, el) => {
        const novelName = loadedCheerio(el).find('a > div.title > h1').text();
        const novelCover = loadedCheerio(el).find('img').attr('src');
        const novelUrl = loadedCheerio(el).find('a').attr('href');

        return {
          name: novelName,
          cover: novelCover,
          path: novelUrl!.replace(/^\//, '').replace(/\/$/, ''),
        };
      })
      .toArray();
  }

  async parseNovel(
    novelPath: string,
  ): Promise<Plugin.SourceNovel> {
    const req = await fetchApi(this.site + '/' + novelPath);
    const body = await req.text();
    const loadedCheerio = loadCheerio(body);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: '', // Will be populated from JSON or HTML
    };

    let novelId: string | null = null;
    let foundNovelInNuxt = false;

    const nuxtData = loadedCheerio('script#__NUXT_DATA__').html();
    if (nuxtData) {
        try {
            const parsed = JSON.parse(nuxtData);
            for (const item of parsed) {
                if (item?.novel?.id) {
                    const nuxtNovel = item.novel;
                    novel.name = nuxtNovel.title;
                    novel.author = nuxtNovel.author_name;
                    
                    if (nuxtNovel.image) {
                        if (nuxtNovel.image.startsWith('http')) {
                            novel.cover = nuxtNovel.image;
                        } else if (nuxtNovel.image.includes('novel_covers/')) {
                            const file = nuxtNovel.image.split('novel_covers/').pop();
                            if (file) {
                                novel.cover = `https://cdn.fictionzone.net/insecure/rs:force:160:240:0/q:90/plain/local:///novel_covers/${file}@webp`;
                            }
                        }
                    }
                    if (!novel.cover) {
                        novel.cover = loadedCheerio('div.novel-img > img').attr('src');
                    }

                    novel.summary = nuxtNovel.overview;

                    const genres = nuxtNovel.genres?.map((g: any) => g.name) || [];
                    const tags = nuxtNovel.tags?.map((t: any) => t.name) || [];
                    novel.genres = [...genres, ...tags].join(',');

                    // Status mapping (1: Ongoing, 2: Completed, 3: Hiatus)
                    if (nuxtNovel.status === 1) novel.status = NovelStatus.Ongoing;
                    if (nuxtNovel.status === 2) novel.status = NovelStatus.Completed;
                    if (nuxtNovel.status === 3) novel.status = NovelStatus.Hiatus;

                    novelId = nuxtNovel.id.toString();
                    this.cachedNovelIds.set(novelPath, novelId);
                    foundNovelInNuxt = true;
                    break;
                }
            }
        } catch (e) {
            // Fallback to scraping if JSON parsing fails
        }
    }

    // Fallback to HTML scraping if NUXT data fails or is incomplete
    if (!foundNovelInNuxt) {
        novel.name = loadedCheerio('div.novel-title > h1').text();
        novel.author = loadedCheerio('div.novel-author > content').text();
        novel.cover = loadedCheerio('div.novel-img > img').attr('src');
        novel.genres = [
          ...loadedCheerio('div.genres > .items > span')
            .map((i, el) => loadedCheerio(el).text())
            .toArray(),
          ...loadedCheerio('div.tags > .items > a')
            .map((i, el) => loadedCheerio(el).text())
            .toArray(),
        ].join(',');
        const status = loadedCheerio('div.novel-status > div.content')
          .text()
          .trim();
        if (status === 'Ongoing') novel.status = NovelStatus.Ongoing;
        if (status === 'Completed') novel.status = NovelStatus.Completed;
        novel.summary = (loadedCheerio('#synopsis > div.content').text() || 
                        loadedCheerio('#synopsis').text() || 
                        loadedCheerio('.synopsis').text() || 
                        loadedCheerio('.novel-description').text() || 
                        loadedCheerio('.description').text())?.trim();
        
        if (!novelId && nuxtData) {
            try {
                const parsed = JSON.parse(nuxtData);
                for (const item of parsed) {
                    if (item?.novel?.id) {
                        novelId = item.novel.id.toString();
                        this.cachedNovelIds.set(novelPath, novelId);
                        break;
                    }
                }
            } catch (e) {
                // ID extraction failed
            }
        }
    }

    if (!novelId) {
      throw new Error('Could not find novel ID for chapter fetching.');
    }

    try {
      novel.chapters = await this.fetchAllChapters(novelId, novelPath);
    } catch (apiError) {
      // Fallback to scraping chapters from HTML
      novel.chapters = loadedCheerio(
        'div.chapters > div.list-wrapper > div.items > a.chapter',
      )
        .map((i, el) => {
          const chapterName = loadedCheerio(el).find('span.chapter-title').text();
          const chapterUrl = loadedCheerio(el)
            .attr('href')
            ?.replace(/^\//, '')
            .replace(/\/$/, '');
          const uploadTime = this.parseAgoDate(
            loadedCheerio(el).find('span.update-date').text(),
          );

          if (!chapterUrl) return null;

          return {
            name: chapterName,
            releaseTime: uploadTime,
            path: chapterUrl,
          };
        })
        .toArray()
        .filter((chap) => {
          return chap !== null && chap.name && chap.path;
        }) as Plugin.ChapterItem[];
    }
    
    return novel;
  }

  async fetchAllChapters(novelId: string, novelPath: string): Promise<Plugin.ChapterItem[]> {
    let allChapters: Plugin.ChapterItem[] = [];
    let currentPage = 1;
    let lastPage = 1;

    do {
      const response = await fetchApi(this.site + '/api/__api_party/api-v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          'path': `/chapter/all/${novelId}`,
          'query': { 'page': currentPage },
          'headers': { 'content-type': 'application/json' },
          'method': 'get',
        }),
      });
      const json = await response.json();

      if (!json._success || !json._data) {
        throw new Error(`API request failed for page ${currentPage}`);
      }

      const chapters = json._data.map((c: any) => ({
        name: c.title,
        releaseTime: new Date(c.created_at).toISOString(),
        path: `${novelPath}/${c.slug}`,
      }));
      
      allChapters.push(...chapters);

      if (json._extra?._pagination) {
        lastPage = json._extra._pagination._last || 1;
      }
      currentPage++;
    } while (currentPage <= lastPage);

    return allChapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const req = await fetchApi(this.site + '/' + chapterPath);
    const body = await req.text();
    const loadedCheerio = loadCheerio(body);
    const content = loadedCheerio('div.chapter-content');
    
    content.find('p').each((i, el) => {
      const p = loadedCheerio(el);
      if (p.text().trim() === '' && p.children().length === 0) {
        p.remove();
      }
    });

    return content.html() || '';
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const term = searchTerm.trim();
    try {
      const res = await fetchApi(this.site + '/api/__api_party/api-v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/novel',
          query: { query: term || undefined, page: pageNo, sort: 'newest' },
          headers: { 'content-type': 'application/json' },
          method: 'get',
        }),
      });
      const json = await res.json();
      if (json?._success && Array.isArray(json._data)) {
        const items: Plugin.NovelItem[] = json._data.map((n: any) => {
          const slug: string = n?.slug;
          const title: string = n?.title || slug?.replace(/[-_]/g, ' ');
            const image: string | undefined = n?.image;
            let cover: string | undefined;
            if (image) {
              if (image.startsWith('http')) cover = image;
              else if (image.includes('novel_covers/')) {
                const file = image.split('novel_covers/').pop();
                if (file) cover = `https://cdn.fictionzone.net/insecure/rs:force:160:240:0/q:90/plain/local:///novel_covers/${file}@webp`;
                if (!cover) cover = `${this.site}/${image.startsWith('novel_covers/') ? 'storage/' + image : image}`;
              } else cover = `${this.site}/${image.replace(/^\//, '')}`;
            }
          return { name: title, path: `novel/${slug}`, cover, author: n?.author_name || undefined } as Plugin.NovelItem;
        });
        if (items.length) return items;
      }
    } catch {}
    // Fallback to HTML search
    return await this.getPage(
      this.site +
        '/library?query=' +
        encodeURIComponent(searchTerm) +
        '&page=' +
        pageNo +
        '&sort=views-all',
    );
  }

  parseAgoDate(date: string | undefined) {
    //parseMadaraDate
    if (date?.includes('ago')) {
      const dayJSDate = dayjs(new Date()); // today
      const timeAgo = date.match(/\d+/)?.[0] || '';
      const timeAgoInt = parseInt(timeAgo, 10);

      if (!timeAgo) return null; // there is no number!

      if (date.includes('hours ago') || date.includes('hour ago')) {
        dayJSDate.subtract(timeAgoInt, 'hours'); // go back N hours
      }

      if (date.includes('days ago') || date.includes('day ago')) {
        dayJSDate.subtract(timeAgoInt, 'days'); // go back N days
      }

      if (date.includes('months ago') || date.includes('month ago')) {
        dayJSDate.subtract(timeAgoInt, 'months'); // go back N months
      }

      if (date.includes('years ago') || date.includes('year ago')) {
        dayJSDate.subtract(timeAgoInt, 'years'); // go back N years
      }

      return dayJSDate.toISOString();
    }
    return null; // there is no "ago" so give up
  }

  resolveUrl = (path: string, isNovel?: boolean) => this.site + '/' + path;
}

export default new FictionZonePlugin();
