import { Plugin } from '@typings/plugin';
import { fetchApi } from '@libs/fetch';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { load as parseHTML } from 'cheerio';

class WTRLAB implements Plugin.PluginBase {
  id = 'WTRLAB';
  name = 'WTR-LAB';
  site = 'https://wtr-lab.com/';
  version = '1.0.1';
  icon = 'src/en/wtrlab/icon.png';
  sourceLang = 'en/';
  
  async popularNovels(
    page: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    let link = this.site + this.sourceLang + 'novel-list?';
    link += `orderBy=${filters.order.value}`;
    link += `&order=${filters.sort.value}`;
    link += `&filter=${filters.storyStatus.value}`;
    link += `&page=${page}`;

    if (showLatestNovels) {
      const response = await fetchApi(this.site + 'api/home/recent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page: page }),
      });

      const recentNovel: JsonNovel = await response.json();

      const novels: Plugin.NovelItem[] = recentNovel.data.map(
        (datum: Datum) => ({
          name: datum.serie.data.title || '',
          cover: datum.serie.data.image,
          path:
            this.sourceLang +
              'serie-' +
              datum.serie.raw_id +
              '/' +
              datum.serie.slug || '',
        }),
      );

      return novels;
    } else {
      const body = await fetchApi(link).then(res => res.text());
      const loadedCheerio = parseHTML(body);
      const novels: Plugin.NovelItem[] = loadedCheerio('.serie-item')
        .map((index, element) => ({
          name:
            loadedCheerio(element)
              .find('.title-wrap > a')
              .text()
              .replace(loadedCheerio(element).find('.rawtitle').text(), '') ||
            '',
          cover: loadedCheerio(element).find('img').attr('src'),
          path: loadedCheerio(element).find('a').attr('href') || '',
        }))
        .get()
        .filter(novel => novel.name && novel.path);
      return novels;
    }
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const body = await fetchApi(this.site + novelPath).then(res => res.text());
    console.log('Novel path:', novelPath);
    
    const loadedCheerio = parseHTML(body);

    const nextDataElement = loadedCheerio('#__NEXT_DATA__');
    const nextDataText = nextDataElement.html();
    
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: '',
      cover: '',
      summary: '',
    };

    if (nextDataText) {
      try {
        const jsonData = JSON.parse(nextDataText);
        const serieData = jsonData?.props?.pageProps?.serie?.serie_data;
        
        console.log('Parsed novel JSON data:', serieData);
        
        if (serieData) {
          novel.name = serieData.data?.title || '';
          novel.cover = serieData.data?.image || '';
          novel.summary = serieData.data?.description || '';
          novel.author = serieData.data?.author || '';
          
          switch (serieData.status) {
            case 0:
              novel.status = 'Ongoing';
              break;
            case 1:
              novel.status = 'Completed';
              break;
            default:
              novel.status = 'Unknown';
          }
        }
      } catch (error) {
        console.error('Failed to parse __NEXT_DATA__:', error);
      }
    }

    if (!novel.name) {
      novel.name = loadedCheerio('h1.text-uppercase').text() || 
                   loadedCheerio('h1.long-title').text() ||
                   loadedCheerio('.title-wrap h1').text().trim();
    }

    if (!novel.cover) {
      novel.cover = loadedCheerio('.image-wrap img').attr('src') || 
                    loadedCheerio('.img-wrap > img').attr('src');
    }

    if (!novel.summary) {
      novel.summary = loadedCheerio('.description').text().trim() || 
                      loadedCheerio('.desc-wrap .description').text().trim() ||
                      loadedCheerio('.lead').text().trim();
    }

    const genres = loadedCheerio('td:contains("Genre")')
      .next()
      .find('a')
      .map((i, el) => loadedCheerio(el).text().replace(/<!--.*?-->/g, '').trim())
      .toArray() || 
      loadedCheerio('.genre')
      .map((i, el) => loadedCheerio(el).text().replace(/<!--.*?-->/g, '').trim())
      .toArray() ||
      loadedCheerio('.genres .genre')
      .map((i, el) => loadedCheerio(el).text().replace(/<!--.*?-->/g, '').trim())
      .toArray();
    
    if (genres.length > 0) {
      novel.genres = genres.filter(genre => genre && genre.length > 0).join(', ');
    }

    const tags = loadedCheerio('td:contains("Tags")')
      .next()
      .find('a')
      .map((i, el) => loadedCheerio(el).text().replace(/<!--.*?-->/g, '').replace(/,$/, '').trim())
      .toArray() ||
      loadedCheerio('.tag')
      .map((i, el) => loadedCheerio(el).text().replace(/<!--.*?-->/g, '').replace(/,$/, '').trim())
      .toArray() ||
      loadedCheerio('.tags .tag')
      .map((i, el) => loadedCheerio(el).text().replace(/<!--.*?-->/g, '').replace(/,$/, '').trim())
      .toArray();
    
    console.log('Found tags from HTML:', tags);
    
    if (tags.length > 0) {
      const existingGenres = novel.genres ? novel.genres.split(', ') : [];
      console.log('Existing genres:', existingGenres);
      const allGenres = [...existingGenres, ...tags].filter(genre => genre && genre.length > 0);
      const uniqueGenres = allGenres.filter((genre, index) => allGenres.indexOf(genre) === index);
      novel.genres = uniqueGenres.join(', ');
      console.log('Combined genres:', novel.genres);
    }

    if (!novel.author) {
      novel.author = loadedCheerio('td:contains("Author")')
        .next()
        .text()
        .replace(/[\t\n]/g, '').trim() || 
        loadedCheerio('td:contains("Author") + td')
        .text()
        .replace(/[\t\n]/g, '').trim();
    }

    if (!novel.status) {
      novel.status = loadedCheerio('td:contains("Status")')
        .next()
        .text()
        .replace(/[\t\n]/g, '').trim() ||
        loadedCheerio('td:contains("Status") + td')
        .text()
        .replace(/[\t\n]/g, '').trim() ||
        loadedCheerio('.detail-line:contains("•")').text().match(/•\s*(\w+)/)?.[1] || '';
    }

    console.log('Final novel data:', novel);

    let rawId: number | null = null;
    let slug: string | null = null;
    let chapterCount = 0;
    
    const urlMatch = novelPath.match(/serie-(\d+)\/([^/]+)/);
    if (urlMatch) {
      rawId = parseInt(urlMatch[1]);
      slug = urlMatch[2];
    }
    
    const chapterCountText = loadedCheerio('.detail-line:contains("Chapters")').text() ||
                             loadedCheerio('div:contains("Chapters")').text();
    const chapterCountMatch = chapterCountText.match(/(\d+)\s+Chapters?/i);
    if (chapterCountMatch) {
      chapterCount = parseInt(chapterCountMatch[1]);
    }
    
    let chapters: Plugin.ChapterItem[] = [];
    
    if (rawId && slug && chapterCount > 0) {
      try {
        chapters = await this.fetchAllChapters(rawId, chapterCount, slug);
      } catch (error) {
        console.error('Failed to fetch chapters via API:', error);
        chapters = [];
      }
    } else {
      console.warn('Could not extract rawId, slug, or chapterCount from page', { rawId, slug, chapterCount });
    }

    novel.chapters = chapters;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    console.log('Chapter path:', chapterPath);
    
    let rawId: number | null = null;
    let chapterNo: number | null = null;

    const urlMatch = chapterPath.match(/serie-(\d+)\/[^/]+\/chapter-(\d+)/);
    if (urlMatch) {
      rawId = parseInt(urlMatch[1], 10);
      chapterNo = parseInt(urlMatch[2], 10);
      console.log('Extracted from URL - rawId:', rawId, 'chapterNo:', chapterNo);
    }

    if (!rawId || !chapterNo) {
      const errorMsg = `Missing required parameters for API call from URL '${chapterPath}' - rawId: ${rawId}, chapterNo: ${chapterNo}. Please check the URL format.`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    console.log(`Making API call with parameters - rawId: ${rawId}, chapterNo: ${chapterNo}`);
    try {
      const apiResponse = await fetchApi(`${this.site}api/reader/get`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          translate: 'ai',
          language: 'en',
          raw_id: rawId,
          chapter_no: chapterNo,
          retry: false,
          force_retry: false
        })
      });

      if (!apiResponse.ok) {
        throw new Error(`API request failed with status: ${apiResponse.status} ${apiResponse.statusText}`);
      }

      const apiData = await apiResponse.json();
      console.log('API response received:', apiData.success ? 'Success' : 'Failed');
      console.log('API response structure:', {
        hasSuccess: 'success' in apiData,
        hasData: 'data' in apiData,
        hasDataData: apiData.data && 'data' in apiData.data,
        hasBody: apiData.data?.data && 'body' in apiData.data.data
      });
      
      if (apiData.success && apiData.data?.data?.body && Array.isArray(apiData.data.data.body)) {
        console.log('Found chapter body in API response, length:', apiData.data.data.body.length);
        
        let htmlString = '';
        for (const text of apiData.data.data.body) {
          if (typeof text === 'string' && text.trim()) {
            htmlString += `<p>${text.trim()}</p>`;
          }
        }
        
        if (htmlString) {
          console.log('Successfully converted API body to HTML, initial length:', htmlString.length);
          
          try {
            const glossaryData = await this.fetchGlossaryTerms(rawId);
            htmlString = this.replaceGlossarySymbols(htmlString, glossaryData);
            console.log('Successfully replaced glossary symbols, final length:', htmlString.length);
          } catch (error) {
            console.warn('Failed to fetch or apply glossary terms:', error instanceof Error ? error.message : String(error));
          }
          
          return htmlString;
        } else {
          throw new Error('Chapter body array was empty or contained no valid text');
        }
      } else if (apiData.error) {
        throw new Error(`API returned error: ${apiData.error}`);
      } else {
        throw new Error('API response did not contain valid chapter content in expected location (data.data.body)');
      }
    } catch (error) {
      console.error('Failed to fetch chapter via API:', error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to fetch chapter content: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async searchNovels(searchTerm: string): Promise<Plugin.NovelItem[]> {
    const response = await fetchApi(this.site + 'api/search', {
      headers: {
        'Content-Type': 'application/json',
        Referer: this.site + this.sourceLang,
        Origin: this.site,
      },
      method: 'POST',
      body: JSON.stringify({ text: searchTerm }),
    });

    const recentNovel: JsonNovel = await response.json();

    const novels: Plugin.NovelItem[] = recentNovel.data.map((datum: Datum) => ({
      name: datum.data.title || '',
      cover: datum.data.image,
      path: this.sourceLang + 'serie-' + datum.raw_id + '/' + datum.slug || '',
    }));

    return novels;
  }

  async fetchAllChapters(rawId: number, totalChapters: number, slug: string): Promise<Plugin.ChapterItem[]> {
    const allChapters: Plugin.ChapterItem[] = [];
    const batchSize = 250;
    
    for (let start = 1; start <= totalChapters; start += batchSize) {
      const end = Math.min(start + batchSize - 1, totalChapters);
      
      try {
        const response = await fetchApi(
          `${this.site}api/chapters/${rawId}?start=${start}&end=${end}`
        );
        
        const data = await response.json();
        
        if (data.chapters && Array.isArray(data.chapters)) {
          const batchChapters: Plugin.ChapterItem[] = data.chapters.map(
            (apiChapter: ApiChapter) => ({
              name: apiChapter.title,
              path: `${this.sourceLang}serie-${rawId}/${slug}/chapter-${apiChapter.order}`,
              releaseTime: apiChapter.updated_at?.substring(0, 10),
              chapterNumber: apiChapter.order,
            })
          );
          
          allChapters.push(...batchChapters);
        }
        
        if (!data.chapters || data.chapters.length < batchSize) {
          break;
        }
      } catch (error) {
        console.error(`Failed to fetch chapters ${start}-${end}:`, error);
        continue;
      }
    }
    
    return allChapters.sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));
  }

  async fetchGlossaryTerms(rawId: number): Promise<GlossaryTerm[]> {
    console.log(`Fetching glossary terms for rawId: ${rawId}`);
    try {
      const response = await fetchApi(`${this.site}api/reader/terms/${rawId}.json`);
      
      if (!response.ok) {
        throw new Error(`Glossary API request failed with status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.glossaries && Array.isArray(data.glossaries) && data.glossaries.length > 0) {
        const glossaryData = data.glossaries[0];
        
        if (glossaryData.data && glossaryData.data.terms && Array.isArray(glossaryData.data.terms)) {
          console.log(`Found ${glossaryData.data.terms.length} glossary terms`);
          
          const terms: GlossaryTerm[] = glossaryData.data.terms.map((term: unknown[], index: number) => {
            const englishTranslations = Array.isArray(term[0]) ? term[0] : [term[0]];
            const chineseOriginal = term[1] || '';
            
            return {
              index: index,
              english: englishTranslations[0] || '',
              chinese: chineseOriginal,
              symbol: `※${index}⛬`
            };
          });
          
          return terms;
        }
      }
      
      console.log('No valid glossary terms found in response');
      return [];
    } catch (error) {
      console.error('Error fetching glossary terms:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  replaceGlossarySymbols(htmlContent: string, glossaryTerms: GlossaryTerm[]): string {
    let result = htmlContent;
    let totalReplacements = 0;
    
    console.log(`Replacing glossary symbols in content with ${glossaryTerms.length} terms`);
    
    for (const term of glossaryTerms) {
      if (term.english && term.symbol) {
        const symbolRegex = new RegExp(term.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = result.match(symbolRegex);
        result = result.replace(symbolRegex, term.english);
        
        if (matches && matches.length > 0) {
          totalReplacements += matches.length;
          console.log(`Replaced ${matches.length} occurrences of ${term.symbol} with "${term.english}"`);
        }
      }
    }
    
    console.log(`Total glossary replacements made: ${totalReplacements}`);
    return result;
  }

  filters = {
    order: {
      value: 'chapter',
      label: 'Order by',
      options: [
        { label: 'View', value: 'view' },
        { label: 'Name', value: 'name' },
        { label: 'Addition Date', value: 'date' },
        { label: 'Reader', value: 'reader' },
        { label: 'Chapter', value: 'chapter' },
      ],
      type: FilterTypes.Picker,
    },
    sort: {
      value: 'desc',
      label: 'Sort by',
      options: [
        { label: 'Descending', value: 'desc' },
        { label: 'Ascending', value: 'asc' },
      ],
      type: FilterTypes.Picker,
    },
    storyStatus: {
      value: 'all',
      label: 'Status',
      options: [
        { label: 'All', value: 'all' },
        { label: 'Ongoing', value: 'ongoing' },
        { label: 'Completed', value: 'completed' },
      ],
      type: FilterTypes.Picker,
    },
  } satisfies Filters;
}

type JsonNovel = {
  success: boolean;
  data: Datum[];
};

type Datum = {
  serie: Serie;
  chapters: Chapter[];
  updated_at: Date;
  raw_id: number;
  slug: string;
  data: Data;
};

type Serie = {
  serie_data: SerieData;
  raw_id: number;
  slug: string;
  data: Data;
};

type SerieData = {
  id: number;
  slug: string;
  status: number;
  data: Data;
  chapter_count: number;
  genres?: number[];
};

type Data = {
  title: string;
  author: string;
  description: string;
  image: string;
};

type Chapter = {
  serie_id: number;
  id: number;
  order: number;
  slug: string;
  title: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type ApiChapter = {
  serie_id: number;
  id: number;
  order: number;
  title: string;
  name: string;
  updated_at: string;
};

type GlossaryTerm = {
  index: number;
  english: string;
  chinese: string;
  symbol: string;
};

export default new WTRLAB();
