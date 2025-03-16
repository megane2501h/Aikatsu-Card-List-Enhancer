// ==UserScript==
// @name         Aikatsu Card List Enhancer (Full Width + Card Copy + Sticky Filter)
// @namespace    https://www.aikatsu.com/
// @version      3.3
// @description  アイカツカードリストに無限スクロールとシンプル表示機能を追加（画面幅最大活用版）+ カード画像クリックでカード名とIDをコピー + スティッキーフィルター
// @author       Claude
// @match        https://www.aikatsu.com/cardlist/*
// @match        http://www.aikatsu.com/cardlist/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = false;
    const defaultSettings = { cardSize: 200, fullWidth: true };
    let userSettings = {
        cardSize: GM_getValue('cardSize', defaultSettings.cardSize),
        fullWidth: GM_getValue('fullWidth', defaultSettings.fullWidth)
    };
    const loadedCardIds = new Set();
    let savedFilterState = { activeTypeFilters: [], activeCategoryFilters: [], activeRarityFilters: [], searchTerm: '' };
    let isSimpleView = false;

    // ユーティリティ関数
    const logDebug = (...args) => { if (DEBUG) console.log('[Aikatsu Enhancer]', ...args); };

    function copyTextToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            showCopyNotification(text);
            return successful;
        } catch (err) {
            logDebug('クリップボードコピーエラー:', err);
            return false;
        } finally {
            document.body.removeChild(textArea);
        }
    }

    function showCopyNotification(text) {
        const existingNotification = document.getElementById('copy-notification');
        if (existingNotification) document.body.removeChild(existingNotification);

        const notification = document.createElement('div');
        notification.id = 'copy-notification';
        notification.textContent = `テキスト「${text}」をコピーしました！`;
        notification.style.cssText = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            background-color: rgba(255, 122, 172, 0.9); color: white;
            padding: 12px 20px; border-radius: 5px; font-weight: bold;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2); z-index: 10000;
            font-family: "メイリオ", Meiryo, sans-serif; font-size: 14px;
            transition: opacity 0.3s ease;
        `;

        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    // カード情報抽出関数
    function extractCardId(card) {
        const headerElement = card.querySelector('th');
        if (!headerElement) return null;
        let fullText = headerElement.textContent.trim();
        let cardId = fullText.split('<')[0].trim();
        return cardId;
    }

    function determineCardType(card) {
        if (card.querySelector('.card-cute')) return 'cute';
        if (card.querySelector('.card-cool')) return 'cool';
        if (card.querySelector('.card-sexy')) return 'sexy';
        if (card.querySelector('.card-accessory')) return 'accessory';
        if (card.querySelector('.card-pop')) return 'pop';
        return '';
    }

    function determineCardCategory(card) {
        const categoryImages = {
            'icon-cttops.jpg': 'tops',
            'icon-ctbottoms.jpg': 'bottoms',
            'icon-ctshoes.jpg': 'shoes',
            'icon-ctaccessory.jpg': 'accessory',
            'icon-cttb.jpg': 'topsbottoms'
        };

        const images = card.querySelectorAll('img');
        for (const img of images) {
            const imgSrc = img.getAttribute('src');
            if (!imgSrc) continue;

            for (const [categoryImg, categoryValue] of Object.entries(categoryImages)) {
                if (imgSrc.includes(categoryImg)) return categoryValue;
            }
        }
        return 'unknown';
    }

    function extractCardRarity(card) {
        const rarityMap = {
            'ノーマル': 'normal',
            'レア': 'rare',
            'プレミアムレア': 'premium',
            'キャンペーンレア': 'campaign'
        };

        const isAccessoryCard = card.querySelector('table.card-accessory') !== null;

        // レアリティヘッダーを探す
        const rarityHeaders = card.querySelectorAll('.tit-cute, .tit-cool, .tit-sexy, .tit-pop, .tit-accessory');
        for (const header of rarityHeaders) {
            if (header.textContent.trim() === 'レアリティ') {
                const headerRow = header.closest('tr');
                const nextRow = headerRow.nextElementSibling;

                if (nextRow) {
                    const headerCells = Array.from(headerRow.cells);
                    const headerIndex = headerCells.indexOf(header);

                    if (headerIndex >= 0) {
                        const rarityCells = nextRow.cells;
                        if (rarityCells.length > headerIndex) {
                            const rarityCell = rarityCells[headerIndex];
                            const text = rarityCell.textContent.trim();

                            if (isAccessoryCard && rarityMap[text]) return rarityMap[text];
                            if (rarityMap[text]) return rarityMap[text];
                            if (text === '-') return 'none';
                        }
                    }
                }
            }
        }

        // 上記で見つからない場合は全行を探索
        const rows = card.querySelectorAll('tr');
        for (let i = 0; i < rows.length; i++) {
            const cells = rows[i].querySelectorAll('td');
            const isRarityRow = Array.from(cells).some(cell =>
                cell.textContent.trim() === 'レアリティ' ||
                cell.classList.contains('tit-accessory') && cell.textContent.trim() === 'レアリティ');

            if (isRarityRow && i + 1 < rows.length) {
                const nextRowCells = rows[i + 1].querySelectorAll('td');
                for (let j = 0; j < nextRowCells.length; j++) {
                    const text = nextRowCells[j].textContent.trim();
                    if (isAccessoryCard && rarityMap[text]) return rarityMap[text];
                    if (rarityMap[text]) return rarityMap[text];
                }
            }

            for (let j = 0; j < cells.length; j++) {
                const text = cells[j].textContent.trim();
                if (isAccessoryCard && rarityMap[text]) return rarityMap[text];
                if (rarityMap[text]) return rarityMap[text];
                if (text === '-' && i > 0 && rows[i-1].textContent.includes('レアリティ')) return 'none';
            }
        }

        if (isAccessoryCard) return 'none';
        return 'unknown';
    }

    function extractCardName(card) {
        const typeSelectors = ['.ltd.tit-cute', '.ltd.tit-cool', '.ltd.tit-sexy', '.ltd.tit-accessory', '.ltd.tit-pop'];

        for (const selector of typeSelectors) {
            const element = card.querySelector(selector);
            if (element && element.nextElementSibling) {
                return element.nextElementSibling.textContent.trim();
            }
        }
        return '不明なカード';
    }

    // 初期設定関数
    function disablePagination() {
        if (window.jQuery) {
            jQuery.fn.pagination = function() { return this; };
            if (jQuery('.paginator').length > 0) {
                jQuery('.paginator').remove();
                showAllCards();
            }
        } else if (window.$) {
            $.fn.pagination = function() { return this; };
            if ($('.paginator').length > 0) {
                $('.paginator').remove();
                showAllCards();
            }
        }

        const styleElement = document.createElement('style');
        styleElement.textContent = '.paginator { display: none !important; }';
        document.head.appendChild(styleElement);

        showAllCards();
    }

    function showAllCards() {
        const allCards = document.querySelectorAll('.card');
        allCards.forEach(card => { card.style.display = ''; });
    }

    function trackExistingCards() {
        document.querySelectorAll('.card').forEach(card => {
            const cardId = extractCardId(card);
            if (cardId) loadedCardIds.add(cardId);
        });
    }

    function addCopyFunctionToDetailCards() {
        document.querySelectorAll('.card').forEach(card => {
            const cardId = extractCardId(card);
            const cardName = extractCardName(card);
            const cardImage = card.querySelector('.td-cardimg img');

            if (cardImage && cardId && cardName) {
                cardImage.style.cursor = 'pointer';
                cardImage.title = `クリックで「${cardName}」 ${cardId}をコピー`;

                cardImage.addEventListener('click', (e) => {
                    e.stopPropagation();
                    copyTextToClipboard(`「${cardName}」 ${cardId}`);
                });
            }
        });
    }

    // UI構築関数
    function addControlPanel() {
        const controlPanel = document.createElement('div');
        controlPanel.id = 'aikatsu-control-panel';
        controlPanel.style.cssText = `
            position: fixed; top: 5px; right: 5px; z-index: 9999;
            background: rgba(255, 255, 255, 0.95); padding: 8px;
            border-radius: 8px; box-shadow: 0 2px 8px rgba(255, 123, 172, 0.3);
            border: 1px solid #FF7BAC; font-size: 12px; width: 180px;
            opacity: 0.9; transition: all 0.3s ease;
            font-family: "メイリオ", Meiryo, sans-serif;
        `;

        const togglePanelButton = document.createElement('button');
        togglePanelButton.id = 'toggle-panel';
        togglePanelButton.innerHTML = '▼';
        togglePanelButton.style.cssText = `
            position: absolute; top: 5px; right: 5px; width: 20px; height: 20px;
            background: #FF7BAC; color: white; border: none; border-radius: 50%;
            cursor: pointer; padding: 0; line-height: 1; font-size: 9px;
            display: flex; align-items: center; justify-content: center;
        `;

        const panelContent = document.createElement('div');
        panelContent.id = 'panel-content';
        panelContent.style.cssText = 'display: block;';

        const panelTitle = document.createElement('div');
        panelTitle.style.cssText = `
            font-weight: bold; text-align: center; margin-bottom: 8px;
            color: #FF5A99; font-size: 13px; padding-bottom: 3px;
            border-bottom: 1px solid #FFD1E3;
        `;
        panelTitle.textContent = 'カードビューア設定';
        panelContent.appendChild(panelTitle);

        const layoutContainer = document.createElement('div');
        layoutContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

        const toggleButton = document.createElement('button');
        toggleButton.id = 'toggle-simple-view';
        toggleButton.textContent = 'シンプル表示に切り替え';
        toggleButton.style.cssText = `
            padding: 6px 8px; cursor: pointer; background: #FF7BAC;
            color: white; border: none; border-radius: 4px; font-weight: bold;
            width: 100%; font-size: 12px; transition: background-color 0.2s;
        `;
        toggleButton.addEventListener('mouseover', () => { toggleButton.style.backgroundColor = '#FF5A99'; });
        toggleButton.addEventListener('mouseout', () => { toggleButton.style.backgroundColor = '#FF7BAC'; });
        layoutContainer.appendChild(toggleButton);

        const settingsContainer = document.createElement('div');
        settingsContainer.id = 'settings-container';
        settingsContainer.style.cssText = `
            display: none; flex-direction: column; gap: 8px; margin-top: 5px;
        `;

        settingsContainer.appendChild(createSizeSlider());
        settingsContainer.appendChild(createFullWidthCheckbox());

        layoutContainer.appendChild(settingsContainer);
        panelContent.appendChild(layoutContainer);

        controlPanel.appendChild(togglePanelButton);
        controlPanel.appendChild(panelContent);
        document.body.appendChild(controlPanel);

        toggleButton.addEventListener('click', toggleSimpleView);
        togglePanelButton.addEventListener('click', () => {
            const panelContent = document.getElementById('panel-content');
            if (panelContent.style.display === 'none') {
                panelContent.style.display = 'block';
                togglePanelButton.innerHTML = '▼';
                controlPanel.style.height = 'auto';
                controlPanel.style.width = '180px';
            } else {
                panelContent.style.display = 'none';
                togglePanelButton.innerHTML = '▲';
                controlPanel.style.height = '30px';
                controlPanel.style.width = '30px';
            }
        });
    }

    function createSizeSlider() {
        const sizeSliderContainer = document.createElement('div');
        sizeSliderContainer.style.cssText = 'display: flex; flex-direction: column; gap: 3px;';

        const sliderLabel = document.createElement('div');
        sliderLabel.style.cssText = 'display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #555;';
        sliderLabel.innerHTML = `
            <span>カードサイズ:</span>
            <span id="size-value" style="font-weight: bold;">${userSettings.cardSize}px</span>
        `;

        const sizeSlider = document.createElement('input');
        sizeSlider.type = 'range';
        sizeSlider.id = 'card-size-slider';
        sizeSlider.min = '120';
        sizeSlider.max = '350';
        sizeSlider.step = '10';
        sizeSlider.value = userSettings.cardSize;
        sizeSlider.style.cssText = 'width: 100%; margin: 2px 0;';

        const sizeRange = document.createElement('div');
        sizeRange.style.cssText = 'display: flex; justify-content: space-between; font-size: 9px; color: #999; margin-top: -2px;';
        sizeRange.innerHTML = '<span>小</span><span>大</span>';

        sizeSliderContainer.appendChild(sliderLabel);
        sizeSliderContainer.appendChild(sizeSlider);
        sizeSliderContainer.appendChild(sizeRange);

        sizeSlider.addEventListener('input', function() {
            const newSize = parseInt(this.value);
            document.getElementById('size-value').textContent = `${newSize}px`;
            userSettings.cardSize = newSize;
            GM_setValue('cardSize', newSize);

            if (isSimpleView) updateSimpleViewStyles();
        });

        return sizeSliderContainer;
    }

    function createFullWidthCheckbox() {
        const fullWidthContainer = document.createElement('label');
        fullWidthContainer.style.cssText = `
            display: flex; align-items: center; font-size: 11px;
            color: #555; cursor: pointer; margin-top: 3px;
        `;

        const fullWidthCheckbox = document.createElement('input');
        fullWidthCheckbox.type = 'checkbox';
        fullWidthCheckbox.id = 'full-width-checkbox';
        fullWidthCheckbox.checked = userSettings.fullWidth;
        fullWidthCheckbox.style.cssText = 'margin-right: 6px;';

        fullWidthContainer.appendChild(fullWidthCheckbox);
        fullWidthContainer.appendChild(document.createTextNode('画面幅いっぱいに表示'));

        fullWidthCheckbox.addEventListener('change', function() {
            userSettings.fullWidth = this.checked;
            GM_setValue('fullWidth', this.checked);

            if (isSimpleView) {
                updateSimpleViewStyles();
                adjustLayoutStructure(this.checked);
            }
        });

        return fullWidthContainer;
    }

    // カード枚数カウント関数
    function countCardsByFilter(type, value) {
        if (isSimpleView) {
            return Array.from(document.querySelectorAll('.simple-card:not(.hidden-card)'))
                .filter(card => {
                    if (type === 'type') {
                        return Array.from(card.classList).includes(value);
                    } else if (type === 'category') {
                        return card.dataset.category === value;
                    } else if (type === 'rarity') {
                        return card.dataset.rarity === value;
                    }
                    return false;
                }).length;
        } else {
            return Array.from(document.querySelectorAll('.card:not([style*="display: none"])'))
                .filter(card => {
                    if (type === 'type') {
                        return determineCardType(card) === value;
                    } else if (type === 'category') {
                        return determineCardCategory(card) === value;
                    } else if (type === 'rarity') {
                        return extractCardRarity(card) === value;
                    }
                    return false;
                }).length;
        }
    }

    // 共通のフィルター作成関数
    function createFilterGroup(options) {
        const {
            type, groupTitle, items, labels, filterGroupStyle, filterTitleStyle,
            activeFilters, onFilterChange, containerId
        } = options;

        const filterGroup = document.createElement('div');
        filterGroup.className = 'filter-group';
        filterGroup.style.cssText = filterGroupStyle;

        const filterTitle = document.createElement('div');
        filterTitle.textContent = groupTitle;
        filterTitle.style.cssText = filterTitleStyle;
        filterGroup.appendChild(filterTitle);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'filter-buttons-container';
        buttonContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px;';

        items.forEach(item => {
            // カード数をカウント
            const cardCount = countCardsByFilter(type, item);

            const button = document.createElement('button');
            button.className = `multi-filter-button ${type}-filter ${item}`;
            button.textContent = `${labels[item]} ${cardCount}`;
            button.dataset[type] = item;
            button.dataset.filterType = type;

            if (activeFilters && activeFilters.includes(item)) {
                button.classList.add('active');
            }

            button.addEventListener('click', () => {
                button.classList.toggle('active');
                if (onFilterChange) onFilterChange();
            });

            buttonContainer.appendChild(button);
        });

        filterGroup.appendChild(buttonContainer);
        return filterGroup;
    }

    // フィルターのカード数表示を更新する関数
    function updateFilterCounts() {
        // タイプフィルター数の更新
        document.querySelectorAll('.type-filter').forEach(btn => {
            const type = btn.dataset.type;
            const count = countCardsByFilter('type', type);
            const label = { 'cute': 'キュート', 'cool': 'クール', 'sexy': 'セクシー', 'pop': 'ポップ' }[type];
            btn.textContent = label;
            btn.dataset.count = count;
        });

        // カテゴリーフィルター数の更新
        document.querySelectorAll('.category-filter').forEach(btn => {
            const category = btn.dataset.category;
            const count = countCardsByFilter('category', category);
            const label = {
                'tops': 'トップス', 'bottoms': 'ボトムス', 'shoes': 'シューズ',
                'accessory': 'アクセサリー', 'topsbottoms': 'トップス＆ボトムス'
            }[category];
            btn.textContent = label;
            btn.dataset.count = count;
        });

        // レアリティフィルター数の更新
        document.querySelectorAll('.rarity-filter').forEach(btn => {
            const rarity = btn.dataset.rarity;
            const count = countCardsByFilter('rarity', rarity);
            const label = {
                'normal': 'ノーマル', 'rare': 'レア', 'premium': 'プレミアムレア',
                'campaign': 'キャンペーンレア', 'none': '-'
            }[rarity];
            btn.textContent = label;
            btn.dataset.count = count;
        });
    }

    function createFilterControls() {
        const existingControls = document.getElementById('filter-controls');
        if (existingControls) existingControls.remove();
        if (!isSimpleView) return;

        const filterControls = document.createElement('div');
        filterControls.id = 'filter-controls';

        const filterGroupsContainer = document.createElement('div');
        filterGroupsContainer.className = 'filter-groups-container';
        filterGroupsContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;';

        const filterGroupStyle = 'flex: 1; min-width: 200px;';
        const filterTitleStyle = 'font-weight: bold; margin-bottom: 5px; color: #FF5A99; font-size: 12px;';

        // タイプフィルター
        filterGroupsContainer.appendChild(createFilterGroup({
            type: 'type',
            groupTitle: 'タイプ',
            items: ['cute', 'cool', 'sexy', 'pop'],
            labels: { 'cute': 'キュート', 'cool': 'クール', 'sexy': 'セクシー', 'pop': 'ポップ' },
            filterGroupStyle,
            filterTitleStyle,
            activeFilters: savedFilterState.activeTypeFilters,
            onFilterChange: applyAllFilters
        }));

        // カテゴリーフィルター
        filterGroupsContainer.appendChild(createFilterGroup({
            type: 'category',
            groupTitle: 'カテゴリー',
            items: ['tops', 'bottoms', 'shoes', 'accessory', 'topsbottoms'],
            labels: {
                'tops': 'トップス', 'bottoms': 'ボトムス', 'shoes': 'シューズ',
                'accessory': 'アクセサリー', 'topsbottoms': 'トップス＆ボトムス'
            },
            filterGroupStyle,
            filterTitleStyle,
            activeFilters: savedFilterState.activeCategoryFilters,
            onFilterChange: applyAllFilters
        }));

        // レアリティフィルター
        filterGroupsContainer.appendChild(createFilterGroup({
            type: 'rarity',
            groupTitle: 'レアリティ',
            items: ['normal', 'rare', 'premium', 'campaign', 'none'],
            labels: {
                'normal': 'ノーマル', 'rare': 'レア', 'premium': 'プレミアムレア',
                'campaign': 'キャンペーンレア', 'none': '-'
            },
            filterGroupStyle,
            filterTitleStyle,
            activeFilters: savedFilterState.activeRarityFilters,
            onFilterChange: applyAllFilters
        }));

        filterControls.appendChild(filterGroupsContainer);
        filterControls.appendChild(createSearchGroup({
            isDetailMode: false,
            searchTerm: savedFilterState.searchTerm
        }));

        applyStickyStyling(filterControls);

        const simpleView = document.getElementById('simple-view');
        if (simpleView) simpleView.parentNode.insertBefore(filterControls, simpleView);
    }

    function createDetailFilterControls() {
        const existingControls = document.getElementById('detail-filter-controls');
        if (existingControls) existingControls.remove();

        const filterControls = document.createElement('div');
        filterControls.id = 'detail-filter-controls';
        filterControls.style.cssText = `
            display: flex; flex-direction: column; margin: 10px auto;
            width: 700px; padding: 10px; background-color: rgba(255, 255, 255, 0.97);
            box-sizing: border-box; box-shadow: 0 0 5px rgba(0,0,0,0.1);
            border-radius: 5px; font-family: "メイリオ", Meiryo, sans-serif;
            font-size: 12px; position: -webkit-sticky; position: sticky;
            top: 140px; z-index: 1000; border-bottom: 1px solid #FFD1E3;
        `;

        const filterGroupsContainer = document.createElement('div');
        filterGroupsContainer.className = 'filter-groups-container';
        filterGroupsContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;';

        const filterGroupStyle = 'flex: 1; min-width: 200px;';
        const filterTitleStyle = 'font-weight: bold; margin-bottom: 5px; color: #FF5A99; font-size: 12px;';

        // 詳細表示用タイプフィルター
        filterGroupsContainer.appendChild(createFilterGroup({
            type: 'type',
            groupTitle: 'タイプ',
            items: ['cute', 'cool', 'sexy', 'pop'],
            labels: { 'cute': 'キュート', 'cool': 'クール', 'sexy': 'セクシー', 'pop': 'ポップ' },
            filterGroupStyle,
            filterTitleStyle,
            activeFilters: savedFilterState.activeTypeFilters,
            onFilterChange: applyDetailFilters,
            containerId: 'detail-filter-controls'
        }));

        // 詳細表示用カテゴリーフィルター
        filterGroupsContainer.appendChild(createFilterGroup({
            type: 'category',
            groupTitle: 'カテゴリー',
            items: ['tops', 'bottoms', 'shoes', 'accessory', 'topsbottoms'],
            labels: {
                'tops': 'トップス', 'bottoms': 'ボトムス', 'shoes': 'シューズ',
                'accessory': 'アクセサリー', 'topsbottoms': 'トップス＆ボトムス'
            },
            filterGroupStyle,
            filterTitleStyle,
            activeFilters: savedFilterState.activeCategoryFilters,
            onFilterChange: applyDetailFilters,
            containerId: 'detail-filter-controls'
        }));

        // 詳細表示用レアリティフィルター
        filterGroupsContainer.appendChild(createFilterGroup({
            type: 'rarity',
            groupTitle: 'レアリティ',
            items: ['normal', 'rare', 'premium', 'campaign', 'none'],
            labels: {
                'normal': 'ノーマル', 'rare': 'レア', 'premium': 'プレミアムレア',
                'campaign': 'キャンペーンレア', 'none': '-'
            },
            filterGroupStyle,
            filterTitleStyle,
            activeFilters: savedFilterState.activeRarityFilters,
            onFilterChange: applyDetailFilters,
            containerId: 'detail-filter-controls'
        }));

        filterControls.appendChild(filterGroupsContainer);
        filterControls.appendChild(createSearchGroup({
            isDetailMode: true,
            searchTerm: savedFilterState.searchTerm
        }));

        const listElement = document.getElementById('list');
        if (listElement) listElement.parentNode.insertBefore(filterControls, listElement);

        // フィルターの数値を初期表示
        setTimeout(() => updateFilterCounts(), 100);
    }

    function createSearchGroup(options) {
        const { isDetailMode, searchTerm } = options;
        const prefix = isDetailMode ? 'detail-' : '';

        const searchGroup = document.createElement('div');
        searchGroup.className = 'search-group';
        searchGroup.style.cssText = 'display: flex; gap: 10px; margin-top: 5px; align-items: center;';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.id = `${prefix}search-input`;
        searchInput.placeholder = 'カード名またはID検索...';
        searchInput.value = searchTerm || '';
        searchInput.style.cssText = `
            padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px;
            flex-grow: 1; font-size: 12px;
        `;

        searchInput.addEventListener('input', () => {
            isDetailMode ? applyDetailFilters() : applyAllFilters();
        });
        searchGroup.appendChild(searchInput);

        const clearButton = document.createElement('button');
        clearButton.id = `${prefix}clear-filter`;
        clearButton.textContent = 'クリア';
        clearButton.style.cssText = `
            padding: 6px 10px; border: none; border-radius: 4px;
            background-color: #f0f0f0; cursor: pointer; transition: all 0.2s;
            font-size: 12px; white-space: nowrap;
        `;
        clearButton.addEventListener('click', () => {
            searchInput.value = '';

            document.querySelectorAll(`#${prefix}filter-controls .multi-filter-button`).forEach(btn => {
                btn.classList.remove('active');
            });

            if (isDetailMode) {
                resetDetailFilters();
            } else {
                resetFilters();
            }

            savedFilterState = {
                activeTypeFilters: [],
                activeCategoryFilters: [],
                activeRarityFilters: [],
                searchTerm: ''
            };
        });
        searchGroup.appendChild(clearButton);

        const cardCount = document.createElement('div');
        cardCount.id = `${prefix}card-count`;
        cardCount.style.cssText = 'margin-left: auto; font-size: 12px; color: #666; font-weight: bold; white-space: nowrap;';
        cardCount.textContent = `表示: ${isDetailMode ?
            document.querySelectorAll('.card:not([style*="display: none"])').length :
            document.querySelectorAll('.simple-card').length}枚`;
        searchGroup.appendChild(cardCount);

        return searchGroup;
    }

    function applyStickyStyling(element) {
        element.setAttribute('style', element.getAttribute('style') || '');
        element.style.setProperty('position', '-webkit-sticky', 'important');
        element.style.setProperty('position', 'sticky', 'important');
        element.style.setProperty('top', '0', 'important');
        element.style.setProperty('z-index', '1000', 'important');
        element.style.setProperty('margin-bottom', '15px', 'important');
        element.style.setProperty('backdrop-filter', 'blur(3px)', 'important');

        const header = document.querySelector('.header');
        if (header) {
            element.style.setProperty('top', `${header.offsetHeight}px`, 'important');
        }
    }

    function addCardToSimpleView(card, container) {
        const cardImgElement = card.querySelector('.td-cardimg img');
        if (!cardImgElement) return;

        const cardImg = cardImgElement.getAttribute('src');
        const cardId = extractCardId(card);
        if (!cardId) return;

        const cardName = extractCardName(card);
        const cardType = determineCardType(card);
        const cardCategory = determineCardCategory(card);
        const cardRarity = extractCardRarity(card);

        const simpleCard = document.createElement('div');
        simpleCard.className = `simple-card ${cardType}`;
        simpleCard.dataset.cardId = cardId;
        simpleCard.dataset.category = cardCategory;
        simpleCard.dataset.rarity = cardRarity;

        const rarityLabel = {
            'normal': 'N', 'rare': 'R', 'premium': 'PR',
            'campaign': 'CP', 'none': '-', 'unknown': '?'
        }[cardRarity];

        simpleCard.innerHTML = `
            <img src="${cardImg}" alt="${cardName}" loading="lazy">
            <div class="card-info">
                <div class="card-id">${cardId}</div>
                <div class="card-rarity">${rarityLabel}</div>
            </div>
            <div class="card-name" title="${cardName}">${cardName}</div>
        `;

        const imgElement = simpleCard.querySelector('img');
        imgElement.style.cursor = 'pointer';
        imgElement.title = `クリックで「${cardName}」 ${cardId}をコピー`;

        imgElement.addEventListener('click', (e) => {
            e.stopPropagation();
            copyTextToClipboard(`「${cardName}」 ${cardId}`);
        });

        simpleCard.addEventListener('click', () => {
            const originalCard = document.getElementById(cardId);
            if (originalCard) {
                restoreDetailView();
                originalCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                originalCard.style.transition = 'background-color 0.5s';
                originalCard.style.backgroundColor = '#ffffcc';
                setTimeout(() => { originalCard.style.backgroundColor = ''; }, 2000);
            }
        });

        container.appendChild(simpleCard);
    }

    // レイアウト調整関数
    function adjustLayoutStructure(fullWidth) {
        if (fullWidth) {
            const styleElement = document.getElementById('layout-override-style') || document.createElement('style');
            styleElement.id = 'layout-override-style';

            styleElement.textContent = `
                body, #container { background: white !important; background-image: none !important; }
                #mainCol {
                    background: white !important; box-shadow: 0 0 20px rgba(255, 123, 172, 0.2) !important;
                    padding: 20px !important; border-radius: 10px !important; margin-top: 20px !important;
                }
                #filter-controls {
                    margin-top: 70px !important; position: -webkit-sticky !important;
                    position: sticky !important; top: 140px !important; z-index: 1000 !important;
                }
                #wrapper-cardlist, #mainCol, #wrapCol, #list {
                    width: 100% !important; max-width: none !important;
                    margin: 0 auto !important; padding: 0 !important; float: none !important;
                }
                #subCol, #pagetop { display: none !important; }
                #simple-view {
                    margin: 20px auto !important; width: 100% !important;
                    max-width: none !important; padding: 0 !important; background: white !important;
                }
                #filter-controls {
                    background: rgba(255, 255, 255, 0.97) !important;
                    border-bottom: 1px solid #FFD1E3 !important;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05) !important;
                    backdrop-filter: blur(3px) !important;
                    position: -webkit-sticky !important; position: sticky !important;
                    top: 140px !important; z-index: 1000 !important;
                }
                #search, .btn_checklist, .notice_aktphone { display: none !important; }
                .mgHead { padding-top: 20px !important; }
            `;

            if (!document.getElementById('layout-override-style')) {
                document.head.appendChild(styleElement);
            }
        } else {
            const styleElement = document.getElementById('layout-override-style');
            if (styleElement) styleElement.textContent = '';
        }
    }

    function updateSimpleViewStyles() {
        const styleElement = document.getElementById('simple-view-style');
        if (!styleElement) return;

        const aspectRatio = 262 / 180;
        const cardWidth = userSettings.cardSize;
        const cardHeight = Math.round(cardWidth * aspectRatio);

        // フィルターボタンのスタイルを拡張（数字用）
        styleElement.textContent = `
            .multi-filter-button {
                display: flex;
                justify-content: space-between;
                align-items: center;
                min-width: 100px;
            }
            .multi-filter-button::after {
                content: attr(data-count);
                display: inline-block;
                background-color: rgba(0, 0, 0, 0.1);
                border-radius: 10px;
                padding: 1px 5px;
                margin-left: 5px;
                font-size: 10px;
                min-width: 15px;
                text-align: center;
            }
            .multi-filter-button.active::after {
                background-color: rgba(255, 255, 255, 0.3);
            }
        `;

        // 元のスタイル定義に追加
        styleElement.textContent += `
            #filter-controls {
                display: flex !important; flex-direction: column !important;
                margin: 10px auto !important; width: 100% !important; padding: 10px !important;
                background-color: rgba(255, 255, 255, 0.97) !important;
                box-sizing: border-box !important; box-shadow: 0 0 5px rgba(0,0,0,0.1) !important;
                border-radius: 5px !important; font-family: "メイリオ", Meiryo, sans-serif !important;
                font-size: 12px !important; position: -webkit-sticky !important;
                position: sticky !important; top: 140px !important; z-index: 1000 !important;
                border-bottom: 1px solid #FFD1E3 !important;
            }
            .multi-filter-button {
                padding: 4px 8px; border: none; border-radius: 4px;
                background-color: #f0f0f0; cursor: pointer; transition: all 0.2s;
                font-size: 11px; font-weight: bold; margin: 2px;
            }
            .multi-filter-button:hover { background-color: #e0e0e0; }
            .multi-filter-button.active { background-color: #FF7BAC; color: white; }
            .type-filter.cute { border-left: 4px solid #FDA7C1; }
            .type-filter.cute.active { background-color: #FDA7C1; color: #BA3F66; }
            .type-filter.cool { border-left: 4px solid #4977AE; }
            .type-filter.cool.active { background-color: #4977AE; color: white; }
            .type-filter.sexy { border-left: 4px solid #8F57A0; }
            .type-filter.sexy.active { background-color: #8F57A0; color: white; }
            .type-filter.pop { border-left: 4px solid #FF9900; }
            .type-filter.pop.active { background-color: #FF9900; color: white; }
            .category-filter { border-left: 4px solid #66CC99; }
            .category-filter.active { background-color: #66CC99; color: white; }
            .rarity-filter { border-left: 4px solid #CC99FF; }
            .rarity-filter.active { background-color: #CC99FF; color: white; }
            .rarity-filter.premium.active {
                background: linear-gradient(135deg, #FF9900, #FFCC00); color: white;
            }
            .rarity-filter.campaign.active {
                background: linear-gradient(135deg, #FF3366, #FF00CC); color: white;
            }
            #simple-view {
                display: flex; flex-wrap: wrap; justify-content: center; gap: 15px;
                margin: 20px auto; width: 100%; padding: 10px;
                box-sizing: border-box; background-color: white;
            }
            .simple-card {
                width: ${cardWidth}px; border-radius: 8px; padding: 10px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center;
                transition: all 0.2s ease; cursor: pointer; position: relative; overflow: hidden;
            }
            .simple-card:hover {
                transform: translateY(-5px);
                box-shadow: 0 5px 15px rgba(0,0,0,0.2); z-index: 10;
            }
            .simple-card img {
                width: 100%; height: auto; border-radius: 5px;
                transition: all 0.3s ease; cursor: pointer;
            }
            .simple-card:hover img { transform: scale(1.02); }
            .card-info {
                display: flex; justify-content: center; align-items: center;
                margin-top: 8px; gap: 5px;
            }
            .simple-card .card-id { font-weight: bold; font-size: 14px; }
            .simple-card .card-rarity {
                font-size: 11px; font-weight: bold; padding: 1px 5px;
                border-radius: 3px; background-color: #f0f0f0;
            }
            .simple-card[data-rarity="normal"] .card-rarity {
                background-color: #aaaaaa; color: white;
            }
            .simple-card[data-rarity="rare"] .card-rarity {
                background-color: #5d93e1; color: white;
            }
            .simple-card[data-rarity="premium"] .card-rarity {
                background: linear-gradient(135deg, #FF9900, #FFCC00); color: white;
            }
            .simple-card[data-rarity="campaign"] .card-rarity {
                background: linear-gradient(135deg, #FF3366, #FF00CC); color: white;
            }
            .simple-card .card-name {
                margin-top: 4px; font-size: 13px; white-space: nowrap;
                overflow: hidden; text-overflow: ellipsis;
            }
            .simple-card.cute {
                background-color: #FEEDF1; border: 1px solid #FDA7C1; color: #BA3F66;
            }
            .simple-card.cute:hover {
                background-color: #ffdce7; box-shadow: 0 5px 15px rgba(253, 167, 193, 0.3);
            }
            .simple-card.cute .card-id { color: #BA3F66; }
            .simple-card.cool {
                background-color: #D0E3FF; border: 1px solid #4977AE; color: #005BAC;
            }
            .simple-card.cool:hover {
                background-color: #bcd6ff; box-shadow: 0 5px 15px rgba(73, 119, 174, 0.3);
            }
            .simple-card.cool .card-id { color: #005BAC; }
            .simple-card.sexy {
                background-color: #E8CEE3; border: 1px solid #8F57A0; color: #920783;
            }
            .simple-card.sexy:hover {
                background-color: #ddbdd6; box-shadow: 0 5px 15px rgba(143, 87, 160, 0.3);
            }
            .simple-card.sexy .card-id { color: #920783; }
            .simple-card.pop {
                background-color: #FFEEDD; border: 1px solid #FF9900; color: #CC6600;
            }
            .simple-card.pop:hover {
                background-color: #ffdfc4; box-shadow: 0 5px 15px rgba(255, 153, 0, 0.3);
            }
            .simple-card.pop .card-id { color: #CC6600; }
            .simple-card.accessory {
                background-color: #E8E8E8; border: 1px solid #666666; color: #333333;
            }
            .simple-card.accessory:hover {
                background-color: #d5d5d5; box-shadow: 0 5px 15px rgba(102, 102, 102, 0.3);
            }
            .simple-card.accessory .card-id { color: #333333; }
            .hidden-card { display: none !important; }
            #detail-filter-controls {
                position: -webkit-sticky; position: sticky; top: 140px; z-index: 1000;
                background-color: rgba(255, 255, 255, 0.97);
                border-bottom: 1px solid #FFD1E3;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
                margin-bottom: 15px; padding-bottom: 10px;
            }
        `;

        createFilterControls();
    }

    // フィルタリング関数
    function applyAllFilters() {
        const cards = document.querySelectorAll('.simple-card');
        let visibleCount = 0;

        const searchTerm = document.getElementById('search-input').value.toLowerCase();
        const activeTypeFilters = Array.from(document.querySelectorAll('.type-filter.active'))
            .map(btn => btn.dataset.type);
        const activeCategoryFilters = Array.from(document.querySelectorAll('.category-filter.active'))
            .map(btn => btn.dataset.category);
        const activeRarityFilters = Array.from(document.querySelectorAll('.rarity-filter.active'))
            .map(btn => btn.dataset.rarity);

        savedFilterState = {
            activeTypeFilters,
            activeCategoryFilters,
            activeRarityFilters,
            searchTerm
        };

        cards.forEach(card => {
            const cardId = card.dataset.cardId.toLowerCase();
            const cardName = card.querySelector('.card-name').textContent.toLowerCase();
            const cardType = Array.from(card.classList).find(cls =>
                ['cute', 'cool', 'sexy', 'pop', 'accessory'].includes(cls));
            const cardCategory = card.dataset.category;
            const cardRarity = card.dataset.rarity;

            const matchesSearch = searchTerm === '' ||
                                cardId.includes(searchTerm) ||
                                cardName.includes(searchTerm);
            const matchesType = activeTypeFilters.length === 0 ||
                                activeTypeFilters.includes(cardType);
            const matchesCategory = activeCategoryFilters.length === 0 ||
                                    activeCategoryFilters.includes(cardCategory);
            const isNoneSelected = activeRarityFilters.includes('none');
            const matchesRarity = activeRarityFilters.length === 0 ||
                                (isNoneSelected ? cardRarity === 'none' : activeRarityFilters.includes(cardRarity));

            if (matchesSearch && matchesType && matchesCategory && matchesRarity) {
                card.classList.remove('hidden-card');
                visibleCount++;
            } else {
                card.classList.add('hidden-card');
            }
        });

        updateCardCount(visibleCount);
        // フィルターのカード数を更新
        updateFilterCounts();
    }

    function filterCards(type) {
        document.querySelectorAll('.type-filter').forEach(btn => {
            btn.classList[btn.dataset.type === type ? 'add' : 'remove']('active');
        });
        applyAllFilters();
    }

    function searchCards(searchTerm) {
        document.getElementById('search-input').value = searchTerm;
        applyAllFilters();
    }

    function resetFilters() {
        document.querySelectorAll('.simple-card').forEach(card => {
            card.classList.remove('hidden-card');
        });
        updateCardCount(document.querySelectorAll('.simple-card').length);
        // フィルターのカード数を更新
        updateFilterCounts();
    }

    function updateCardCount(count) {
        const cardCount = document.getElementById('card-count');
        if (cardCount) cardCount.textContent = `表示: ${count}枚`;
    }

    function applyDetailFilters() {
        const cards = document.querySelectorAll('.card');
        let visibleCount = 0;

        const searchInput = document.getElementById('detail-search-input');
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        const activeTypeFilters = Array.from(document.querySelectorAll('#detail-filter-controls .type-filter.active'))
            .map(btn => btn.dataset.type);
        const activeCategoryFilters = Array.from(document.querySelectorAll('#detail-filter-controls .category-filter.active'))
            .map(btn => btn.dataset.category);
        const activeRarityFilters = Array.from(document.querySelectorAll('#detail-filter-controls .rarity-filter.active'))
            .map(btn => btn.dataset.rarity);

        savedFilterState = {
            activeTypeFilters,
            activeCategoryFilters,
            activeRarityFilters,
            searchTerm
        };

        cards.forEach(card => {
            const cardId = extractCardId(card);
            const cardName = extractCardName(card);
            const cardType = determineCardType(card);
            const cardCategory = determineCardCategory(card);
            const cardRarity = extractCardRarity(card);

            const matchesSearch = searchTerm === '' ||
                                (cardId && cardId.toLowerCase().includes(searchTerm)) ||
                                (cardName && cardName.toLowerCase().includes(searchTerm));
            const matchesType = activeTypeFilters.length === 0 ||
                                activeTypeFilters.includes(cardType);
            const matchesCategory = activeCategoryFilters.length === 0 ||
                                    activeCategoryFilters.includes(cardCategory);
            const isNoneSelected = activeRarityFilters.includes('none');
            const matchesRarity = activeRarityFilters.length === 0 ||
                                (isNoneSelected ? cardRarity === 'none' : activeRarityFilters.includes(cardRarity));

            if (matchesSearch && matchesType && matchesCategory && matchesRarity) {
                card.style.display = '';
                visibleCount++;
            } else {
                card.style.display = 'none';
            }
        });

        updateDetailCardCount(visibleCount);
        // フィルターのカード数を更新
        updateFilterCounts();
    }

    function updateDetailCardCount(count) {
        const cardCount = document.getElementById('detail-card-count');
        if (cardCount) cardCount.textContent = `表示: ${count}枚`;
    }

    function resetDetailFilters() {
        document.querySelectorAll('.card').forEach(card => {
            card.style.display = '';
        });
        updateDetailCardCount(document.querySelectorAll('.card').length);
        // フィルターのカード数を更新
        updateFilterCounts();
    }

    // 表示モード切替関数
    function createSimpleView() {
        document.getElementById('list').style.display = 'none';

        if (!document.getElementById('simple-view-style')) {
            const styleElement = document.createElement('style');
            styleElement.id = 'simple-view-style';
            document.head.appendChild(styleElement);
        }
        updateSimpleViewStyles();

        if (!document.getElementById('simple-view')) {
            const simpleView = document.createElement('div');
            simpleView.id = 'simple-view';

            document.querySelectorAll('.card').forEach(card => {
                card.style.display = '';
                addCardToSimpleView(card, simpleView);
            });

            document.getElementById('list').insertAdjacentElement('afterend', simpleView);

            const totalCards = document.querySelectorAll('.card').length;
            const endMessage = document.createElement('div');
            endMessage.id = 'end-message';
            endMessage.style.cssText = `
                text-align: center; padding: 20px; margin: 20px auto;
                font-weight: bold; color: #666; width: 100%;
                border-top: 1px dashed #ccc;
            `;
            endMessage.textContent = `全${totalCards}枚のカードを表示しています`;
            simpleView.appendChild(endMessage);

            createFilterControls();

            setTimeout(() => {
                // フィルターのカード数を更新
                updateFilterCounts();

                if (savedFilterState.activeTypeFilters.length > 0 ||
                    savedFilterState.activeCategoryFilters.length > 0 ||
                    savedFilterState.activeRarityFilters.length > 0 ||
                    savedFilterState.searchTerm) {
                    applyAllFilters();
                }
            }, 100);
        } else {
            document.getElementById('simple-view').style.display = 'flex';
            createFilterControls();

            setTimeout(() => {
                // フィルターのカード数を更新
                updateFilterCounts();

                if (savedFilterState.activeTypeFilters.length > 0 ||
                    savedFilterState.activeCategoryFilters.length > 0 ||
                    savedFilterState.activeRarityFilters.length > 0 ||
                    savedFilterState.searchTerm) {
                    applyAllFilters();
                }
            }, 100);
        }
    }

    function toggleSimpleView() {
        if (!isSimpleView) {
            const detailSearchInput = document.getElementById('detail-search-input');
            const searchTerm = detailSearchInput ? detailSearchInput.value.toLowerCase() : '';
            const activeTypeFilters = Array.from(document.querySelectorAll('#detail-filter-controls .type-filter.active'))
                .map(btn => btn.dataset.type);
            const activeCategoryFilters = Array.from(document.querySelectorAll('#detail-filter-controls .category-filter.active'))
                .map(btn => btn.dataset.category);
            const activeRarityFilters = Array.from(document.querySelectorAll('#detail-filter-controls .rarity-filter.active'))
                .map(btn => btn.dataset.rarity);

            savedFilterState = {
                activeTypeFilters,
                activeCategoryFilters,
                activeRarityFilters,
                searchTerm
            };

            resetDetailFilters();
        }

        isSimpleView = !isSimpleView;

        const toggleButton = document.getElementById('toggle-simple-view');
        const settingsContainer = document.getElementById('settings-container');

        const detailFilterControls = document.getElementById('detail-filter-controls');
        if (detailFilterControls) detailFilterControls.remove();

        if (isSimpleView) {
            toggleButton.textContent = '詳細表示に戻す';
            settingsContainer.style.display = 'flex';
            createSimpleView();
            adjustLayoutStructure(userSettings.fullWidth);
        } else {
            toggleButton.textContent = 'シンプル表示に切り替え';
            settingsContainer.style.display = 'none';
            restoreDetailView();
            adjustLayoutStructure(false);
        }
    }

    function restoreDetailView() {
        if (document.getElementById('simple-view')) {
            document.getElementById('simple-view').style.display = 'none';
        }

        if (document.getElementById('filter-controls')) {
            document.getElementById('filter-controls').style.display = 'none';
        }

        document.getElementById('list').style.display = 'block';
        document.querySelectorAll('.card').forEach(card => {
            card.style.display = '';
        });

        createDetailFilterControls();
        applyDetailFilters();

        const layoutStyleElement = document.getElementById('layout-override-style');
        if (layoutStyleElement) layoutStyleElement.textContent = '';

        const toggleButton = document.getElementById('toggle-simple-view');
        const settingsContainer = document.getElementById('settings-container');

        if (toggleButton) toggleButton.textContent = 'シンプル表示に切り替え';
        if (settingsContainer) settingsContainer.style.display = 'none';

        isSimpleView = false;
    }

    // 初期化と起動処理
    function init() {
        logDebug('Aikatsu Card List Enhancer を初期化中... (バージョン 3.3)');
        addCustomStyles();
        disablePagination();

        setTimeout(() => {
            showAllCards();
            const totalCards = document.querySelectorAll('.card').length;
            logDebug(`全カード表示完了: ${totalCards}枚のカードを表示`);
        }, 500);

        trackExistingCards();
        addControlPanel();
        addCopyFunctionToDetailCards();
        createDetailFilterControls();
    }

    function addCustomStyles() {
        const customStyles = document.createElement('style');
        customStyles.innerHTML = `
            #loading-indicator {
                text-align: center; padding: 20px; color: #FF7BAC; font-weight: bold;
            }
            #end-message {
                text-align: center; padding: 20px; margin: 20px auto;
                font-weight: bold; color: #666; width: 100%; border-top: 1px dashed #ccc;
            }
            .card { display: block; }
            .td-cardimg img { cursor: pointer; }
            #detail-filter-controls .multi-filter-button {
                display: flex; justify-content: space-between; align-items: center;
                padding: 4px 8px; border: none; border-radius: 4px;
                background-color: #f0f0f0; cursor: pointer; transition: all 0.2s;
                font-size: 11px; font-weight: bold; margin: 2px; min-width: 100px;
            }
            #detail-filter-controls .multi-filter-button:hover { background-color: #e0e0e0; }
            #detail-filter-controls .multi-filter-button.active { background-color: #FF7BAC; color: white; }
            #detail-filter-controls .multi-filter-button::after {
                content: attr(data-count);
                display: inline-block;
                background-color: rgba(0, 0, 0, 0.1);
                border-radius: 10px;
                padding: 1px 5px;
                margin-left: 5px;
                font-size: 10px;
                min-width: 15px;
                text-align: center;
            }
            #detail-filter-controls .multi-filter-button.active::after {
                background-color: rgba(255, 255, 255, 0.3);
            }
            #detail-filter-controls .type-filter.cute { border-left: 4px solid #FDA7C1; }
            #detail-filter-controls .type-filter.cute.active { background-color: #FDA7C1; color: #BA3F66; }
            #detail-filter-controls .type-filter.cool { border-left: 4px solid #4977AE; }
            #detail-filter-controls .type-filter.cool.active { background-color: #4977AE; color: white; }
            #detail-filter-controls .type-filter.sexy { border-left: 4px solid #8F57A0; }
            #detail-filter-controls .type-filter.sexy.active { background-color: #8F57A0; color: white; }
            #detail-filter-controls .type-filter.pop { border-left: 4px solid #FF9900; }
            #detail-filter-controls .type-filter.pop.active { background-color: #FF9900; color: white; }
            #detail-filter-controls .category-filter { border-left: 4px solid #66CC99; }
            #detail-filter-controls .category-filter.active { background-color: #66CC99; color: white; }
            #detail-filter-controls .rarity-filter { border-left: 4px solid #CC99FF; }
            #detail-filter-controls .rarity-filter.active { background-color: #CC99FF; color: white; }
            #detail-filter-controls .rarity-filter.premium.active {
                background: linear-gradient(135deg, #FF9900, #FFCC00); color: white;
            }
            #detail-filter-controls .rarity-filter.campaign.active {
                background: linear-gradient(135deg, #FF3366, #FF00CC); color: white;
            }
        `;
        document.head.appendChild(customStyles);
    }

    function waitForElements() {
        if (document.querySelector('#list') && document.querySelectorAll('.card').length > 0) {
            logDebug('カードリストを検出しました');

            if (window.jQuery) {
                if (typeof jQuery.fn.pagination === 'function') {
                    logDebug('jQueryの既存のpagination関数を直接上書き');
                    jQuery.fn.pagination = function() { return this; };
                    if (jQuery('.paginator').length > 0) jQuery('.paginator').remove();
                }
            }

            const script = document.createElement('script');
            script.textContent = `
                if (window.jQuery) {
                    jQuery.fn.pagination = function() { return this; };
                } else if (window.$) {
                    $.fn.pagination = function() { return this; };
                }
                window.itemsPerPage = 9999;
                window.paginatorStyle = 0;
            `;
            document.head.appendChild(script);

            init();
            setTimeout(showAllCards, 1000);
        } else {
            setTimeout(waitForElements, 100);
        }
    }

    waitForElements();
})();