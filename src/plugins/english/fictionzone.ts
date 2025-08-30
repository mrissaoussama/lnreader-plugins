import { fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { Filters } from '@libs/filterInputs';
import { load as loadCheerio } from 'cheerio';
import { NovelStatus } from '@libs/novelStatus';
import dayjs from 'dayjs';

class FictionZonePlugin implements Plugin.PluginBase {
  id = 'fictionzone';
  name = 'Fiction Zone';
  icon = 'src/en/fictionzone/icon.png';
  site = 'https://fictionzone.net';
  version = '1.0.2';
  filters: Filters | undefined = undefined;
  imageRequestInit?: Plugin.ImageRequestInit | undefined = undefined;

  //flag indicates whether access to LocalStorage, SesesionStorage is required.
  webStorageUtilized?: boolean;

  cachedNovelIds: Map<string, string> = new Map();

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
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
      name: loadedCheerio('div.novel-title > h1').text(),
    };

    // novel.artist = '';
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
    novel.summary = loadedCheerio('#synopsis > div.content').text();

    let nuxtData = loadedCheerio('script#__NUXT_DATA__').html();
    let parsed = JSON.parse(nuxtData!);
    let novelId = null;
    for (let a of parsed) {
      if (typeof a === 'string' && a.startsWith('novel_covers/')) break;
      if (typeof a === 'object' && a?.novel?.id) {
        novelId = a.novel.id.toString();
        break;
      }
      novelId = a; // fallback to last object
    }
    
    if (novelId) {
      this.cachedNovelIds.set(novelPath, novelId.toString());
      try {
        novel.chapters = await this.fetchAllChapters(novelId.toString(), novelPath);
      } catch (error) {
        // Fallback to HTML parsing if API fails
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
          .filter((chap) => chap !== null && !!chap.path) as Plugin.ChapterItem[];
      }
    }

    return novel;
  }

  async fetchAllChapters(novelId: string, novelPath: string): Promise<Plugin.ChapterItem[]> {
    const allChapters: Plugin.ChapterItem[] = [];
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
    return loadedCheerio('div.chapter-content').html() || '';
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
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
