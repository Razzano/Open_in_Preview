(() => {
  'use strict';
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Open in Preview     *************************************************************************************************************
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const KEYCODE_CONFIG = 'Ctrl+Alt+Period, Ctrl+Shift+F, Esc, Alt+Period'; // User defined
  // First & second keys = searchForSelectedText(), third & fourth keys = removePreview(viewId)
  const IMAGE_CONFIG = { preview: '🖥️ ', }; // or 🔍
  const PREVIEW_WINDOW_CONFIG = { height: 100, width: 100, }; // Percentage values

  const CONTEXT_MENU_CONFIG = {
    linkMenuTitle: 'Open in Preview',
    searchMenuTitle: 'Search in Preview',
    selectSearchMenuTitle: 'Select Search for Preview',
  };
  const ICON_CONFIG = {
    linkIcon: '',
    linkIconInteractionOnHover: false,
    showIconDelay: 150,
    showPreviewOnHoverDelay: 200,
  };
  const TIMING_CONFIG = {
    closeTimeout: 800,
    fade: 100,
    fadeDelay: 100,
    middleClickDelay: 400,
    optionsHideDelay: 100,
	previewDelay: 100,
    progressEasing: 0.12,
	titleFetchDelay: 2000,
  };

  setTimeout(function waitPreview() {
    const browser = document.getElementById('browser');
    if (!browser) {
        return setTimeout(waitPreview, TIMING_CONFIG.previewDelay);
    }
    new PreviewWindow();
  }, TIMING_CONFIG.previewDelay);

  const chromeAsync = {
    getLastFocusedWindow: () => new Promise(resolve => chrome.windows.getLastFocused(resolve)),
    getCurrentWindow: () => new Promise(resolve => chrome.windows.getCurrent(resolve)),
    queryTabs: query => new Promise(resolve => chrome.tabs.query(query, resolve)),
    removeTab: tabId => new Promise(resolve => chrome.tabs.remove(tabId, resolve)),
    getSelectedText: tabId => new Promise(resolve => vivaldi.utilities.getSelectedText(tabId, resolve))
  };

  let showUrlInput = false;

  class PreviewWindow {
    rootBrowser = document.getElementById('browser');
    #canvasContext = document.createElement('canvas').getContext('2d');
    webviews = new Map();
    addListener(target, event, handler, options) {
      target.addEventListener(event, handler, options);
      this._listeners.push({ target, event, handler, options });
      return handler;
    }
    removeAllListeners() {
      for (const l of this._listeners) {
        l.target.removeEventListener(l.event, l.handler, l.options);
      }
      this._listeners.length = 0;
    }
    #iconUtils;
    get iconUtils() {
      return this.#iconUtils ??= new IconUtils();
    }
    #renderer;
    get renderer() {
      return this.#renderer ??= new PreviewRenderer(this);
    }
    searchEngineUtils = new SearchEngineUtils(
      url => this.previewWindow(url),
      (engineId, searchText) => this.previewWindowSearch(engineId, searchText),
      CONTEXT_MENU_CONFIG
    );
    READER_VIEW_URL = 'https://www.smry.ai/proxy?url=';
    constructor() {
      this._listeners = [];
	  vivaldi.tabsPrivate.onKeyboardShortcut.addListener((id, combination) => {
		const webviewValues = Array.from(this.webviews.values());
        let webviewData = webviewValues.at(-1);
        if (!webviewData.fromPanel) {
          const tabId = Number(this.getActiveWebview()?.tab_id);
          webviewData = webviewValues.findLast(_data => _data.tabId === tabId);
        }
		let viewId = webviewData.webview.id;
        if (!KEYCODE_CONFIG || typeof KEYCODE_CONFIG !== 'string') return;
        const normalize = (str) => str.toLowerCase().replace(/\s+/g, '');
        const key_Code = KEYCODE_CONFIG.split(',').map(k => normalize(k)).filter(Boolean);
        const key_Position = normalize(combination);
        if (!key_Code.length) return;
		const [first, second, third, fourth, fifth] = key_Code;
	    if (key_Position === first || key_Position === second) {
		  this.searchForSelectedText();
        } else if (key_Position === third || key_Position === fourth) {
          this.removePreview(viewId);
		}
      });
      new WebsiteInjectionUtils(
        navigationDetails => this.getWebviewConfig(navigationDetails),
        (url, fromPanel, origin) => this.previewWindow(url, fromPanel, origin),
        ICON_CONFIG
      );
      window.addEventListener('unload', () => this.cleanupAll());
    }
    getWebviewConfig(navigationDetails) {
      if (navigationDetails.frameType !== 'outermost_frame') {
        return { webview: null, fromPanel: false };
      }
      const tabSelector = `webview[tab_id="${navigationDetails.tabId}"]`;
      const webview = document.querySelector(tabSelector);
      if (webview) {
        return { webview, fromPanel: webview.name === 'vivaldi-webpanel' };
      }
      const panelView = [...this.webviews.values()].find(v => v.fromPanel)?.webview;
      if (panelView) {
        return { webview: panelView, fromPanel: true };
      }
      const active = this.getActiveWebview();
      const container = active?.closest('.preview-container');
      const lastWebviewId = container?.querySelector('webview')?.id;
      return { webview: this.webviews.get(lastWebviewId)?.webview, fromPanel: false };
    }
    getActiveWebview() {
      return document.querySelector('.active.visible.webpageview webview');
    }
    async searchForSelectedText() {
      try {
        const tabs = await chromeAsync.queryTabs({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab) return;
        let text = await chromeAsync.getSelectedText(tab.id);
        if (!text) return;
        this.previewWindowSearch(this.searchEngineUtils.defaultSearchId, text);
      } catch (e) {
        console.error('searchForSelectedText failed:', e);
    } }
    async previewWindowSearch(engineId, selectionText) {
      const searchRequest = await vivaldi.searchEngines.getSearchRequest(engineId, selectionText);
      this.previewWindow(searchRequest.url);
    }
    removePreview(webviewId) {
      const data = this.webviews.get(webviewId);
      if (!data) return;
      const container = data.divContainer;
      const previewWindow = container?.querySelector('.preview-window');
      if (!container || !previewWindow) return;
      if (container.dataset.closing === '1') return;
      container.dataset.closing = '1';
      const pointerX = Number(container.dataset.pointerX ?? window.innerWidth / 2);
      const pointerY = Number(container.dataset.pointerY ?? window.innerHeight / 2);
      this.setAnchoredTransformVars(previewWindow, pointerX, pointerY);
      requestAnimationFrame(() => {
        container.classList.remove('is-open');
        container.classList.add('is-leave');
        container.style.backdropFilter = 'none';
        previewWindow.classList.add('animating-close');
        const finishRemoval = async () => {
          const tabs = await chromeAsync.queryTabs({});
          const tab = tabs.find(t =>String(t.vivExtData || '').includes(`${webviewId}tabId`));
          if (tab) {
            await chromeAsync.removeTab(tab.id);
          }
          container.classList.remove('is-leave');
          data.divContainer.remove();
          if (data.tabCloseListener) {
            chrome.tabs.onRemoved.removeListener(data.tabCloseListener);
          }
          if (data.pointerdownListener) {
            document.body.removeEventListener('pointerdown', data.pointerdownListener);
          }
          this.webviews.delete(webviewId);
        };
        const onCloseEnd = e => {
          if (e.animationName === 'preview-window-close-anchored') {
            previewWindow.removeEventListener('animationend', onCloseEnd);
            finishRemoval();
          }
        };
        previewWindow.addEventListener('animationend', onCloseEnd);
        setTimeout(finishRemoval, TIMING_CONFIG.closeTimeout);
      });
    }
    async previewWindow(linkUrl, fromPanel = undefined, origin = undefined) {
      let lastFocused, current;
      try {
        [lastFocused, current] = await Promise.all([
          chromeAsync.getLastFocusedWindow(),
          chromeAsync.getCurrentWindow()
        ]);
      } catch (err) {
        console.error('Failed to get windows:', err);
        return;
      }
      const isValidWindow =
        lastFocused.id === current.id &&
        lastFocused.state !== chrome.windows.WindowState.MINIMIZED;
      if (!isValidWindow) return;
      const url = await UrlUtils.normalizeOrSearch(linkUrl, this.searchEngineUtils);
      this.showPreview(url, fromPanel, origin);
    }
    showPreview(linkUrl, fromPanel, origin) {
      const webviewId = `dialog-${this.getWebviewId()}`;
      const {
        previewContainer,
        previewWindow,
        webview,
        optionsContainer,
        progressBar
      } = this.renderer.createBaseElements(webviewId, linkUrl);
      if (fromPanel === undefined && this.webviews.size !== 0) {
        fromPanel = Array.from(this.webviews.values()).at(-1).fromPanel;
      }
      const activeWebview = this.getActiveWebview();
      const tabId = !fromPanel && activeWebview ? Number(activeWebview.tab_id) : null;
      this.webviews.set(webviewId, {
        divContainer: previewContainer,
        webview: webview,
        fromPanel: fromPanel,
        tabId: tabId,
        pointerdownListener: null,
        pointerdownAttached: false
      });
      if (!fromPanel) {
        const clearWebviews = closedTabId => {
          if (tabId === closedTabId) {
            this.webviews.forEach((view, key) => view.tabCloseListener === clearWebviews && this.removePreview(key));
            chrome.tabs.onRemoved.removeListener(clearWebviews);
          }
        };
        this.webviews.get(webviewId).tabCloseListener = clearWebviews;
        chrome.tabs.onRemoved.addListener(clearWebviews);
        this._tabListeners ??= new Set();
        this._tabListeners.add(clearWebviews);
      }
      previewWindow.setAttribute('class', 'preview-window');
      this.renderer.applyInitialSizing(previewWindow, this.webviews.size);
      optionsContainer.setAttribute('class', 'options-container');
      let pageTitle = linkUrl;
      const fadeDuration = TIMING_CONFIG.fade;
      let timeout;
      let showingOptions = false;
      optionsContainer.textContent = IMAGE_CONFIG.preview + pageTitle;
      optionsContainer.addEventListener('mouseover', () => {
        if (!showingOptions) {
          optionsContainer.classList.add('fade-out');
          setTimeout(() => {
            optionsContainer.innerHTML = '';
            this.showWebviewOptions(webviewId, optionsContainer);
            optionsContainer.classList.remove('fade-out');
            showingOptions = true;
          }, fadeDuration);
        }
        clearTimeout(timeout);
      });
      optionsContainer.addEventListener('mouseleave', () => {
        timeout = setTimeout(() => {
          optionsContainer.classList.add('fade-out');
          setTimeout(() => {
            optionsContainer.textContent = IMAGE_CONFIG.preview + pageTitle;
            optionsContainer.classList.remove('fade-out');
            showingOptions = false;
          }, fadeDuration);
        }, TIMING_CONFIG.optionsHideDelay);
      });
      let currentPageUrl = '';
      let titleFetched = false;
      webview.id = webviewId;
      webview.tab_id = `${webviewId}tabId`;
      webview.setAttribute('src', linkUrl);
      currentPageUrl = linkUrl;
      titleFetched = false;
      let isLoading = false;
      webview.addEventListener('loadstart', () => {
        webview.style.backgroundColor = 'var(--colorBorder)';
        progressBar.start();
		if (showUrlInput) {
          const input = document.getElementById(`input-${webview.id}`);
          if (input !== null) {
            input.value = webview.src;
          }
		}
        isLoading = true;
		webview.focus();
      });
      webview.addEventListener('loadcommit', () => {
        titleFetched = false;
        progressBar.clear(true);
      });
      webview.addEventListener('loadstop', () => {
        progressBar.clear(true);
        const expectedSrc = webview.src;
        setTimeout(() => {
          let title = '';
          try {
            if (webview.getTitle) {
              title = webview.getTitle();
            }
            if (!title) {
              webview.executeScript({ code: 'document.title' }, (results) => {
                if (!results || !results[0]) return;
                const resolvedTitle = results[0];
                if (webview.src === expectedSrc && resolvedTitle) {
                  pageTitle = resolvedTitle;
                  titleFetched = true;
                  if (!showingOptions) {
                    optionsContainer.textContent = IMAGE_CONFIG.preview + pageTitle;
                } }
              });
            } else {
              if (webview.src === expectedSrc) {
                pageTitle = title;
                titleFetched = true;
                if (!showingOptions) {
                  optionsContainer.textContent = IMAGE_CONFIG.preview + pageTitle;
            } } }
          } catch (e) {
            console.error('Title fetch failed:', e);
          }
        }, TIMING_CONFIG.titleFetchDelay);
      });
      previewContainer.setAttribute('class', 'preview-container');
      const pointerX = origin?.x ?? window.innerWidth / 2;
      const pointerY = origin?.y ?? window.innerHeight / 2;
      previewContainer.dataset.pointerX = String(pointerX);
      previewContainer.dataset.pointerY = String(pointerY);
      const stopEvent = event => {
        event.preventDefault();
        event.stopPropagation();
		if (showUrlInput && event.target.id === `input-${webviewId}`) {
          const inputElement = event.target;
          const offsetX = event.clientX - inputElement.getBoundingClientRect().left;
          this.#canvasContext.font = window.getComputedStyle(inputElement).font;
          const text = inputElement.value;
          let low = 0,
              high = text.length;
          while (low < high) {
            const mid = (low + high) >> 1;
            const width = this.#canvasContext.measureText(text.slice(0, mid)).width;
            if (width < offsetX) low = mid + 1;
            else high = mid;
          }
          const cursorPosition = low;
          inputElement.focus({ preventScroll: true });
          inputElement.setSelectionRange(cursorPosition, cursorPosition);
        }
      };
      if (fromPanel) {
        const boundStopEvent = stopEvent.bind(this);
        this.addListener(document.body, 'pointerdown', boundStopEvent);
        this.webviews.get(webviewId).pointerdownListener = boundStopEvent;
      }
      previewContainer.addEventListener('click', event => {
        if (event.target === previewContainer) {
          this.removePreview(webviewId);
        }
      });
      this.renderer.attachStructure({
        previewContainer,
        previewWindow,
        optionsContainer,
        progressBar,
        webview
      });
      this.renderer.mount(previewContainer, fromPanel, this.rootBrowser);
      this.renderer.runOpenAnimation(
        previewWindow,
        previewContainer,
        pointerX,
        pointerY,
        this.setAnchoredTransformVars.bind(this),
        TIMING_CONFIG
      );
    }
    setAnchoredTransformVars(previewWindow, viewportX, viewportY, s0 = 0.1) {
      const rect = previewWindow.getBoundingClientRect();
      const dx = viewportX - rect.left;
      const dy = viewportY - rect.top;
      const t0x = (1 - s0) * dx;
      const t0y = (1 - s0) * dy;
      previewWindow.style.setProperty('--s0', String(s0));
      previewWindow.style.setProperty('--tx0', `${t0x}px`);
      previewWindow.style.setProperty('--ty0', `${t0y}px`);
      return { t0x, t0y, s0 };
    }
    showWebviewOptions(webviewId, thisElement) {
      let inputId = `input-${webviewId}`;
      let data = this.webviews.get(webviewId);
      let webview = data ? data.webview : undefined;
      if (webview && document.getElementById(inputId) === null) {
        let input = null;
      if (showUrlInput) {
        input = document.createElement('input');
        input.value = webview.src;
        input.id = inputId;
        input.setAttribute('class', 'url-input');
        input.addEventListener('keydown', async event => {
          if (event.key === 'Enter') {
            let value = input.value;
            const resolvedUrl = await UrlUtils.normalizeOrSearch(value, this.searchEngineUtils);
            webview.src = resolvedUrl;
          }
        });
      }
      const fragment = document.createDocumentFragment(),
        buttons = [
          { content: this.iconUtils.back, 
			action: () => webview.back(),
			cls: 'back-button',
			tooltip: 'Back'
		  },
          { content: this.iconUtils.forward,
			action: () => webview.forward(),
			cls: 'forward-button',
			tooltip: 'Forward'
		  },
          { content: this.iconUtils.reload,
			action: () => webview.reload(),
			cls: 'reload-button',
			tooltip: 'Reload page'
		  },
          { content: this.iconUtils.readerView,
            action: this.showReaderView.bind(this, webview),
            cls: 'reader-button',
            tooltip: 'Toggle Reader View'
          },
          { content: this.iconUtils.newTab,
            action: () =>
			showUrlInput
            ? this.openNewTab(inputId, true)
            : this.openNewTabFromWebview(webview, true),
			cls: 'newtab-button',
            tooltip: 'Open in new tab'
          },
          { content: this.iconUtils.backgroundTab,
            action: () =>
			showUrlInput
            ? this.openNewTab(inputId, false)
            : this.openNewTabFromWebview(webview, false),
		    cls: 'background-button',
            tooltip: 'Open in background tab'
          },
	      { content: this.iconUtils.toggleBtn,
			action: () => showUrlInput = !showUrlInput,
			cls: 'toggle-button',
			tooltip: 'Toggle url-input'
          },
	      { content: this.iconUtils.closeBtn,
			action: () => this.removePreview(webviewId),
			cls: 'close-button',
			tooltip: 'Close preview'
          }
        ];
        buttons.forEach(button =>
          fragment.appendChild(
            this.createOptionsButton(
              button.content,
              button.action,
              button.cls || '',
              button.tooltip
            )
	      )
        );
        if (input) fragment.appendChild(input);
        thisElement.append(fragment);
    } }
    createOptionsButton(content, clickListenerCallback, cls = '', tooltip = '') {
      const button = document.createElement('button');
      button.className = `options-button ${cls}`.trim();
      button.addEventListener('click', clickListenerCallback);
      if (tooltip) {
        button.dataset.tooltip = tooltip;
      }
      if (typeof content === 'string') {
        button.innerHTML = content;
      } else {
        button.appendChild(content);
      }
      return button;
    }
    getWebviewId() {
      const timestamp = Date.now();
      const randomPart = Math.random().toString(36).substring(2, 11);
      return `${timestamp}-${randomPart}`;
    }
    showReaderView(webview) {
      const previewWindow = webview.parentElement;
      if (webview.src.includes(this.READER_VIEW_URL)) {
        webview.src = webview.src.replace(this.READER_VIEW_URL, '');
        previewWindow.classList.remove('reader-open');
      } else {
        webview.src = this.READER_VIEW_URL + webview.src;
        previewWindow.classList.add('reader-open');
    } }
    async openNewTab(inputId, active) {
      const input = document.getElementById(inputId).value;
      const url = await UrlUtils.normalizeOrSearch(input, this.searchEngineUtils);
      chrome.tabs.create({ url, active });
    }
    openNewTabFromWebview(webview, active) {
      chrome.tabs.create({ url: webview.src, active });
    }
    cleanupAll() {
      this.removeAllListeners();
      if (this._tabListeners) {
        for (const fn of this._tabListeners) {
          chrome.tabs.onRemoved.removeListener(fn);
        }
        this._tabListeners.clear();
      }
      this.webviews.clear();
	  webview.remove();
      container.remove();
	  this.webviews.delete(webviewId);
      if (this.lastWebviewId === webviewId) {
        this.lastWebviewId = Array.from(this.webviews.keys()).at(-1)?? null;
  } } }

  class PreviewRenderer {
    constructor(context) {
      this.ctx = context;
    }
    createBaseElements(webviewId, linkUrl) {
      const previewContainer = document.createElement('div');
      const previewWindow = document.createElement('div');
      const webview = document.createElement('webview');
      const optionsContainer = document.createElement('div');
      const progressBar = new ProgressBar(webviewId);
      previewWindow.className = 'preview-window';
      optionsContainer.className = 'options-container';
      previewContainer.className = 'preview-container';
      webview.id = webviewId;
      webview.tab_id = `${webviewId}tabId`;
      webview.setAttribute('src', linkUrl);
      return {
        previewContainer,
        previewWindow,
        webview,
        optionsContainer,
        progressBar
      };
    }
    attachStructure({ previewContainer, previewWindow, optionsContainer, progressBar, webview }) {
      previewWindow.appendChild(optionsContainer);
      previewWindow.appendChild(progressBar.element);
      previewWindow.appendChild(webview);
      previewContainer.appendChild(previewWindow);
    }
    mount(previewContainer, fromPanel, rootBrowser) {
      (fromPanel
      ? (rootBrowser || document.querySelector('#browser'))
      : document.querySelector('.active.visible.webpageview')
      ).appendChild(previewContainer);
    }
    applyInitialSizing(previewWindow, stackIndex) {
	  previewWindow.style.width = PREVIEW_WINDOW_CONFIG.width * stackIndex + '%';
      previewWindow.style.height = PREVIEW_WINDOW_CONFIG.height * stackIndex + '%';
      previewWindow.style.visibility = 'hidden';
    }
    runOpenAnimation(previewWindow, previewContainer, pointerX, pointerY, setAnchoredTransformVars, durations) {
      requestAnimationFrame(() => {
        const t = setAnchoredTransformVars(previewWindow, pointerX, pointerY);
        Object.assign(previewWindow.style, {
          transform: `translate(${t.t0x}px, ${t.t0y}px) scale(${t.s0})`,
          opacity: '0',
          visibility: 'visible'
        });
        requestAnimationFrame(() => {
          previewWindow.getBoundingClientRect();
          requestAnimationFrame(() => {
            previewContainer.classList.add('is-open');
          });
        });
        requestAnimationFrame(() => {
          previewContainer.classList.add('is-open');
          setTimeout(() => {
            previewWindow.classList.add('animating-open');
            const onOpenEnd = e => {
              if (e.animationName === 'preview-window-open-anchored') {
                previewWindow.classList.remove('animating-open');
                previewWindow.style.removeProperty('transform');
                previewWindow.style.removeProperty('opacity');
                previewWindow.removeEventListener('animationend', onOpenEnd);
              }
            };
            previewWindow.addEventListener('animationend', onOpenEnd);
          }, durations.fadeDelay);
        });
      });
  } }

  class UrlUtils {
    static VALID_PREFIXES = [
      'http://',
      'https://',
      'file://',
      'vivaldi://',
      'chrome://',
      'chrome-extension://',
      'data:',
      'blob:'
    ];
    static BLOCKED_SCHEMES = [
      'javascript:',
      'vbscript:'
    ];
    static isValid(url) {
      if (!url || typeof url !== 'string') return false;
      const trimmed = url.trim().toLowerCase();
      if (this.BLOCKED_SCHEMES.some(s => trimmed.startsWith(s))) {
        return false;
      }
      if (trimmed.startsWith('about:')) return true;
      return this.VALID_PREFIXES.some(prefix => trimmed.startsWith(prefix));
    }
    static async normalizeOrSearch(input, searchEngineUtils) {
      if (this.isValid(input)) {
        return input;
      }
      const searchRequest = await vivaldi.searchEngines.getSearchRequest(
        searchEngineUtils.defaultSearchId,
        input
      );
      return searchRequest.url;
  } }

  class WebsiteInjectionUtils {
    constructor(getWebviewConfig, openPreview, iconConfig) {
      this.iconConfig = JSON.stringify(iconConfig);
      chrome.webNavigation.onCompleted.addListener(navigationDetails => {
        const { webview, fromPanel } = getWebviewConfig(navigationDetails);
        webview && this.injectCode(webview, fromPanel);
      });
      chrome.runtime.onMessage.addListener(message => {
        if (message.url) {
          openPreview(message.url, message.fromPanel, message.origin);
        }
      });
    }
    injectCode(webview, fromPanel) {
      const handler = WebsiteLinkInteractionHandler.toString();
      const instantiationCode = `
        if (window.__dialogHandlerInitialized) return;
        window.__dialogHandlerInitialized = true;
        window.__previewInjectedCleanupRun = () => {
          window.__previewInjectedCleanup?.forEach(fn => fn());
          window.__previewInjectedCleanup?.clear?.();
        };
        window.addEventListener('beforeunload', () => {
          window.__previewInjectedCleanupRun?.();
        });
        window.addEventListener('pagehide', () => {
          window.__previewInjectedCleanupRun?.();
        });
        new (${handler})(${fromPanel}, ${this.iconConfig});
      `;
      try {
        webview.executeScript({ code: instantiationCode }, () => {
          if (chrome.runtime.lastError) {
            console.debug('Preview mod: Script injection failed:', chrome.runtime.lastError.message);
          }
        });
      } catch (error) {
        console.debug('Preview mod: Failed to execute script:', error);
  } } }

  class WebsiteLinkInteractionHandler {
    constructor(fromPanel, config) {
      window.__previewInjectedCleanup ??= new Set();
      this.fromPanel = fromPanel;
      this.config = config;
      this.icon = null;
      this.timers = { showIcon: null, showPreview: null, hideIcon: null };
      this.boundHideIcon = this.#hideLinkIcon.bind(this);
      this.#initialize();
    }
    #initialize() {
      this.#setupMouseHandling();
      if (this.config.linkIcon) {
        this.#setupIconHandling();
    } }
    #setupMouseHandling() {
      let holdTimerForMiddleClick;
      const pointerDownHandler = event => {
        if (event.ctrlKey && event.altKey && [0, 1].includes(event.button)) {
          this.#callPreview(event);
        } else if (event.button === 1) {
          const link = this.#getLinkElement(event);
          if (!link) return;
          const px = event.clientX;
          const py = event.clientY;
          const href = link.href;
          holdTimerForMiddleClick = setTimeout(() => {
            this.#sendPreviewMessage(href, px, py);
          }, TIMING_CONFIG.middleClickDelay);
        }
      };
      const pointerUpHandler = event => {
        if (event.button === 1) clearTimeout(holdTimerForMiddleClick);
      };
      document.addEventListener('pointerdown', pointerDownHandler);
      document.addEventListener('pointerup', pointerUpHandler);
      window.__previewInjectedCleanup ??= new Set();
      window.__previewInjectedCleanup.add(() => {
        document.removeEventListener('pointerdown', pointerDownHandler);
        document.removeEventListener('pointerup', pointerUpHandler);
      });
    }
    #setupIconHandling() {
      this.#createIcon();
      this.#createIconStyle();
      document.addEventListener(
        'mouseover',
        this.debounce(event => {
          const link = this.#getLinkElement(event);
          if (!link) return;
          clearTimeout(this.timers.hideIcon);
          requestAnimationFrame(() => {
            const rect = link.getBoundingClientRect();
            Object.assign(this.icon.style, {
              display: 'block',
              left: `${rect.right + 5}px`,
              top: `${rect.top + window.scrollY}px`
            });
          });
          this.icon.dataset.targetUrl = link.href;
          this.currentLinkEl = link;
          link.addEventListener('mouseleave', this.boundHideIcon);
        }, this.config.showIconDelay)
      );
    }
    #createIcon() {
      const icon = document.createElement('div');
      icon.className = `link-icon ${this.config.linkIcon}`;
      icon.style.display = 'none';
      const getLinkCenter = () => {
        const el = this.currentLinkEl;
        if (el) {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }
        return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
      };
      if (this.config.linkIconInteractionOnHover) {
        icon.addEventListener('mouseenter', () => {
          this.timers.showPreview = setTimeout(() => {
            const { x, y } = getLinkCenter();
            this.#sendPreviewMessage(this.icon.dataset.targetUrl, x, y);
          }, this.config.showPreviewOnHoverDelay);
        });
        icon.addEventListener('mouseleave', () => clearTimeout(this.timers.showPreview));
      } else {
        icon.addEventListener('click', () => {
          const { x, y } = getLinkCenter();
          this.#sendPreviewMessage(this.icon.dataset.targetUrl, x, y);
        });
        icon.addEventListener('mouseenter', () => clearTimeout(this.timers.hideIcon));
        this.boundHideIcon = this.#hideLinkIcon.bind(this);
        icon.addEventListener('mouseleave', this.boundHideIcon);
      }
      this.icon = icon;
      document.body.appendChild(this.icon);
    }
    #hideLinkIcon() {
      this.timers.hideIcon = setTimeout(
        () => {
          this.icon.style.display = 'none';
          clearTimeout(this.timers.showIcon);
        },
        this.config.linkIconInteractionOnHover ? 300 : 600
      );
    }
    #getLinkElement(event) {
      return event.target.closest('a[href]:not([href="#"])');
    }
    #sendPreviewMessage(url, x, y) {
      chrome.runtime.sendMessage({ url, fromPanel: this.fromPanel, origin: { x, y } });
    }
    #callPreview(event) {
      let link = this.#getLinkElement(event);
      if (link) {
        event.preventDefault();
        this.#sendPreviewMessage(link.href, event.clientX, event.clientY);
    } }
    #createIconStyle() {
      const style = document.createElement('style');
      style.textContent = `
        .link-icon {
          position: absolute;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
          cursor: pointer;
          z-index: 9999;
          transition: opacity 0.2s ease;
        }
        .link-icon:hover {
          opacity: 0.9;
        }
      `;
      document.head.appendChild(style);
    }
    debounce(fn, delay) {
      let timer = null;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(fn.bind(this, ...args), delay);
      };
  } }

  class SearchEngineUtils {
    constructor(openLinkCallback, searchCallback, config = {}) {
      this.openLinkCallback = openLinkCallback;
      this.searchCallback = searchCallback;
      this.linkMenuTitle = config.linkMenuTitle;
      this.searchMenuTitle = config.searchMenuTitle;
      this.selectSearchMenuTitle = config.selectSearchMenuTitle;
      this.createdContextMenuMap = new Map();
      this.searchEngineCollection = [];
      this.defaultSearchId = null;
      this.privateSearchId = null;
      this.LINK_ID = 'preview-window-link';
      this.SEARCH_ID = 'search-preview-window';
      this.SELECT_SEARCH_ID = 'select-search-preview-window';
      this.#initialize();
    }
    async #initialize() {
      this.#createContextMenuOption();
      this.#updateSearchEnginesAndContextMenu();
      vivaldi.searchEngines.onTemplateUrlsChanged.addListener(() => {
        this.#removeContextMenuSelectSearch();
        this.#updateSearchEnginesAndContextMenu();
      });
    }
    #createContextMenuOption() {
      chrome.contextMenus.create({
        id: this.LINK_ID,
        title: `${this.linkMenuTitle}`,
        contexts: ['link']
      });
      chrome.contextMenus.create({
        id: this.SEARCH_ID,
        title: `${this.searchMenuTitle}`,
        contexts: ['selection']
      });
      chrome.contextMenus.create({
        id: this.SELECT_SEARCH_ID,
        title: `${this.selectSearchMenuTitle}`,
        contexts: ['selection']
      });
      chrome.contextMenus.onClicked.addListener(itemInfo => {
        const { menuItemId, parentMenuItemId, linkUrl, selectionText } = itemInfo;
        if (menuItemId === this.LINK_ID) {
          this.openLinkCallback(linkUrl);
        } else if (menuItemId === this.SEARCH_ID) {
          const engineId = window.incognito ? this.privateSearchId : this.defaultSearchId;
          this.searchCallback(engineId, selectionText);
        } else if (parentMenuItemId === this.SELECT_SEARCH_ID) {
          const engineId = menuItemId.substr(parentMenuItemId.length);
          this.searchCallback(engineId, selectionText);
        }
      });
    }
    async #updateSearchEnginesAndContextMenu() {
      const searchEngines = await vivaldi.searchEngines.getTemplateUrls();
      this.searchEngineCollection = searchEngines.templateUrls;
      this.defaultSearchId = searchEngines.defaultSearch;
      this.privateSearchId = searchEngines.defaultPrivate;
      this.#createContextMenuSelectSearch();
    }
    #removeContextMenuSelectSearch() {
      this.createdContextMenuMap.forEach((_, engineId) => {
        const menuId = this.SELECT_SEARCH_ID + engineId;
        chrome.contextMenus.remove(menuId);
      });
      this.createdContextMenuMap.clear();
    }
    #createContextMenuSelectSearch() {
      this.searchEngineCollection.forEach(engine => {
        if (!this.createdContextMenuMap.has(engine.guid)) {
          chrome.contextMenus.create({
            id: this.SELECT_SEARCH_ID + engine.guid,
            parentId: this.SELECT_SEARCH_ID,
            title: engine.name,
            contexts: ['selection']
          });
          this.createdContextMenuMap.set(engine.guid, true);
        }
      });
  } }

  class ProgressBar {
    static CLEAR_DELAY = 250;
    constructor(webviewId) {
      this.webviewId = webviewId;
      this.progress = 0;
      this.element = this.#createProgressBar(webviewId);
      this._raf = null;
    }
    #createProgressBar(webviewId) {
      const el = document.createElement('div');
      el.className = 'progress-bar';
      el.id = `progressBar-${webviewId}`;
      return el;
    }
    start() {
      this.element.style.visibility = 'visible';
      this.element.classList.remove('is-complete');
      this.progress = 0;
      this.element.style.width = '0%';
      this.#animateTo(85);
    }
    #animateTo(target) {
      cancelAnimationFrame(this._raf);
      const step = () => {
        this.progress += (target - this.progress) * TIMING_CONFIG.progressEasing;
        this.element.style.width = `${this.progress.toFixed(2)}%`;
        if (this.progress < target - 0.5) {
          this._raf = requestAnimationFrame(step);
        }
      };
      this._raf = requestAnimationFrame(step);
    }
    clear(loadStop = false) {
      cancelAnimationFrame(this._raf);
      this.element.classList.add('is-complete');
      if (loadStop) {
        this.element.style.width = '100%';
        setTimeout(() => {
          this.progress = 0;
          this.element.style.visibility = 'hidden';
          this.element.style.width = '0%';
        }, ProgressBar.CLEAR_DELAY);
      }
    }
    destroy() {
      cancelAnimationFrame(this._raf);
      this._raf = null;
  } }

  class IconUtils {
    static SVG = {
      readerView:
        '<svg xmlns="http://www.w3.org/2000/svg" width="1.5em" height="1.5em" viewBox="0 0 24 24"><path d="M5.525 17.056h8.75c.29 0 .525.323.525.722 0 .365-.198.668-.454.715l-.071.007h-8.75c-.29 0-.525-.323-.525-.722 0-.366.198-.668.454-.716zh8.75Zm0-3.852h12.95c.29 0 .525.323.525.722 0 .366-.198.668-.454.716l-.071.006H5.525c-.29 0-.525-.323-.525-.722 0-.366.198-.668.454-.716zh12.95Zm0-3.852h12.95c.29 0 .525.323.525.722 0 .366-.198.668-.454.716l-.071.007H5.525c-.29 0-.525-.324-.525-.723 0-.366.198-.668.454-.716zh12.95Zm0-3.852h12.95c.29 0 .525.323.525.722 0 .366-.198.668-.454.716l-.071.006H5.525c-.29 0-.525-.323-.525-.722 0-.365.198-.668.454-.715zh12.95z"></path></svg>',
      newTab:
        '<svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 512 512"><path d="M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32h82.7L201.4 265.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3V192c0 17.7 14.3 32 32 32s32-14.3 32-32V32c0-17.7-14.3-32-32-32H320zM80 32C35.8 32 0 67.8 0 112V432c0 44.2 35.8 80 80 80H400c44.2 0 80-35.8 80-80V320c0-17.7-14.3-32-32-32s-32-14.3-32-32V432c0 8.8-7.2 16-16 16H80c-8.8 0-16-7.2-16-16V112c0-8.8 7.2-16 16-16H192c17.7 0 32-14.3 32-32s-14.3-32-32-32H80z"/></svg>',
      backgroundTab:
        '<svg xmlns="http://www.w3.org/2000/svg" height="1.1em" viewBox="0 0 448 512"><path d="M384 32c35.3 0 64 28.7 64 64V416c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V96C0 60.7 28.7 32 64 32H384zM160 144c-13.3 0-24 10.7-24 24s10.7 24 24 24h94.1L119 327c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l135-135V328c0 13.3 10.7 24 24 24s24-10.7 24-24V168c-13.3 0-24-10.7-24-24H160z"/></svg>',
	  toggleBtn:
		'<svg xmlns="http://www.w3.org/2000/svg" height="1.5em" width="1.5em" viewBox="0 0 24 24"><path d="M 16 15.395 a 0.5 0.5 0 0 1 0.762 -0.426 L 22.5 18.5 l -5.738 3.531 a 0.5 0.5 0 0 1 -0.762 -0.425 v -6.212 Z M 14 19 H 4 a 1 1 0 1 1 0 -2 h 10 v 2 Z m 6 -8 a 1 1 0 1 1 0 2 H 4 a 1 1 0 1 1 0 -2 h 16 Z m 0 -6 a 1 1 0 1 1 0 2 H 4 a 1 1 0 0 1 0 -2 h 16 Z"/></svg>',
	  closeBtn:
		'<svg xmlns="http://www.w3.org/2000/svg" height="1.5em" width="1.5em" viewBox="0 0 44 44"><path d="M38 12.83L35.17 10 24 21.17 12.83 10 10 12.83 21.17 24 10 35.17 12.83 38 24 26.83 35.17 38 38 35.17 26.83 24z"/></svg>',
    };
    static VIVALDI_BUTTONS = [
      {
        name: 'back',
        buttonName: 'Back',
        fallback:
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M14.354 18 9 12l5.354-6 .646.725L10.297 12 15 17.271z"/></svg>'
      },
      {
        name: 'forward',
        buttonName: 'Forward',
        fallback:
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M15 12 9.646 6 9 6.725 13.703 12 9 17.271l.646.729z"/></svg>'
      },
      {
        name: 'reload',
        buttonName: 'Reload',
        fallback:
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12.2 6.367a5.833 5.833 0 1 0 5.77 4.971c-.052-.353.206-.694.563-.694.289 0 .542.2.586.485q.08.525.081 1.071a7 7 0 1 1-2.333-5.218v-.81a.583.583 0 1 1 1.166 0v2.334a.583.583 0 0 1-.583.583h-2.333a.583.583 0 0 1 0-1.167h1.049A5.8 5.8 0 0 0 12.2 6.367"/></svg>'
      }
    ];
    #initialized = false;
    #iconMap = new Map();
    constructor() {
      this.#initializeStaticIcons();
    }
    #initializeStaticIcons() {
      Object.entries(IconUtils.SVG).forEach(([key, value]) => {
        this.#iconMap.set(key, value);
      });
    }
    #initializeVivaldiIcons() {
      if (this.#initialized) return;
      IconUtils.VIVALDI_BUTTONS.forEach(button => {
        this.#iconMap.set(button.name, this.#getVivaldiButton(button.buttonName, button.fallback));
      });
      this.#initialized = true;
    }
    #getVivaldiButton(buttonName, fallbackSVG) {
      const svg = document.querySelector(`.button-toolbar [data-name="${buttonName}"] svg`);
      return svg ? svg.cloneNode(true).outerHTML : fallbackSVG;
    }
    getIcon(name) {
      if (!this.#initialized && IconUtils.VIVALDI_BUTTONS.some(btn => btn.name === name)) {
        this.#initializeVivaldiIcons();
      }
      return this.#iconMap.get(name) || '';
    }
    get back() {
      return this.getIcon('back');
    }
    get forward() {
      return this.getIcon('forward');
    }
    get reload() {
      return this.getIcon('reload');
    }
    get readerView() {
      return this.getIcon('readerView');
    }
    get newTab() {
      return this.getIcon('newTab');
    }
    get backgroundTab() {
      return this.getIcon('backgroundTab');
    }
	get toggleBtn() {
      return this.getIcon('toggleBtn');
    }
	get closeBtn() {
      return this.getIcon('closeBtn');
    }
  }
})();
