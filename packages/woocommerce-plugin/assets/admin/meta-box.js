/* global jQuery, wp, paskamerAdmin */
/**
 * Paskamer product meta box: repeater tables, media-library flat-lay picker, colour swatches,
 * custom pattern block toggle. No network requests — everything happens on the edit screen.
 */
(function ($) {
	'use strict';

	function renumber($table) {
		var key = $table.data('repeater');
		$table.find('tbody tr').each(function (i) {
			$(this).find('input').each(function () {
				var name = this.getAttribute('name');
				if (!name) return;
				this.setAttribute('name', name.replace(new RegExp('\\[' + key + '\\]\\[\\d+\\]'), '[' + key + '][' + i + ']'));
			});
		});
	}

	$(document).on('click', '.paskamer-repeater .paskamer-row-add', function () {
		var $table = $(this).closest('.paskamer-repeater');
		var $last = $table.find('tbody tr').last();
		var $clone = $last.clone();
		$clone.find('input').each(function () {
			if (this.type === 'color') { this.value = '#ffffff'; } else { this.value = ''; }
		});
		$table.find('tbody').append($clone);
		renumber($table);
		$clone.find('input').first().trigger('focus');
	});

	$(document).on('click', '.paskamer-repeater .paskamer-row-remove', function () {
		var $table = $(this).closest('.paskamer-repeater');
		var $rows = $table.find('tbody tr');
		if ($rows.length <= 1) {
			$rows.find('input').val('');
			return;
		}
		$(this).closest('tr').remove();
		renumber($table);
	});

	// Pattern block "Other…" reveals a free-text input.
	$(document).on('change', '.paskamer-pattern-block', function () {
		var $custom = $(this).siblings('.paskamer-pattern-block-custom');
		if (this.value === '__custom') { $custom.show().trigger('focus'); } else { $custom.hide().val(''); }
	});

	// Hex text <-> colour swatch.
	$(document).on('input', '.paskamer-hex', function () {
		var v = this.value.trim();
		if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
			$(this).siblings('.paskamer-swatch').val(v.charAt(0) === '#' ? v : '#' + v);
		}
	});
	$(document).on('input', '.paskamer-swatch', function () {
		$(this).siblings('.paskamer-hex').val(this.value.toUpperCase());
	});

	// Flat-lay media picker.
	var frame = null;
	$(document).on('click', '.paskamer-flatlay-pick', function (e) {
		e.preventDefault();
		var $box = $(this).closest('.paskamer-flatlay');
		if (!window.wp || !wp.media) return;
		if (!frame) {
			frame = wp.media({
				title: paskamerAdmin.chooseFlatLay,
				button: { text: paskamerAdmin.useImage },
				library: { type: 'image' },
				multiple: false
			});
		}
		frame.off('select').on('select', function () {
			var att = frame.state().get('selection').first().toJSON();
			var url = (att.sizes && att.sizes.medium && att.sizes.medium.url) || att.url;
			$box.find('.paskamer-flatlay-id').val(att.id);
			$box.find('.paskamer-flatlay-preview').html($('<img>', { src: url, alt: '' }));
			$box.find('.paskamer-flatlay-remove').show();
		});
		frame.open();
	});
	$(document).on('click', '.paskamer-flatlay-remove', function (e) {
		e.preventDefault();
		var $box = $(this).closest('.paskamer-flatlay');
		$box.find('.paskamer-flatlay-id').val('0');
		$box.find('.paskamer-flatlay-preview').empty();
		$(this).hide();
	});
})(jQuery);
