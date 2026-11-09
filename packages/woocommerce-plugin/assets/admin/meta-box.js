/* global jQuery, wp, curtainAdmin */
/**
 * Curtain product meta box: repeater tables, media-library flat-lay picker, colour swatches,
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

	$(document).on('click', '.curtain-repeater .curtain-row-add', function () {
		var $table = $(this).closest('.curtain-repeater');
		var $last = $table.find('tbody tr').last();
		var $clone = $last.clone();
		$clone.find('input').each(function () {
			if (this.type === 'color') { this.value = '#ffffff'; } else { this.value = ''; }
		});
		$table.find('tbody').append($clone);
		renumber($table);
		$clone.find('input').first().trigger('focus');
	});

	$(document).on('click', '.curtain-repeater .curtain-row-remove', function () {
		var $table = $(this).closest('.curtain-repeater');
		var $rows = $table.find('tbody tr');
		if ($rows.length <= 1) {
			$rows.find('input').val('');
			return;
		}
		$(this).closest('tr').remove();
		renumber($table);
	});

	// Pattern block "Other…" reveals a free-text input.
	$(document).on('change', '.curtain-pattern-block', function () {
		var $custom = $(this).siblings('.curtain-pattern-block-custom');
		if (this.value === '__custom') { $custom.show().trigger('focus'); } else { $custom.hide().val(''); }
	});

	// Hex text <-> colour swatch.
	$(document).on('input', '.curtain-hex', function () {
		var v = this.value.trim();
		if (/^#?[0-9a-fA-F]{6}$/.test(v)) {
			$(this).siblings('.curtain-swatch').val(v.charAt(0) === '#' ? v : '#' + v);
		}
	});
	$(document).on('input', '.curtain-swatch', function () {
		$(this).siblings('.curtain-hex').val(this.value.toUpperCase());
	});

	// Flat-lay media picker.
	var frame = null;
	$(document).on('click', '.curtain-flatlay-pick', function (e) {
		e.preventDefault();
		var $box = $(this).closest('.curtain-flatlay');
		if (!window.wp || !wp.media) return;
		if (!frame) {
			frame = wp.media({
				title: curtainAdmin.chooseFlatLay,
				button: { text: curtainAdmin.useImage },
				library: { type: 'image' },
				multiple: false
			});
		}
		frame.off('select').on('select', function () {
			var att = frame.state().get('selection').first().toJSON();
			var url = (att.sizes && att.sizes.medium && att.sizes.medium.url) || att.url;
			$box.find('.curtain-flatlay-id').val(att.id);
			$box.find('.curtain-flatlay-preview').html($('<img>', { src: url, alt: '' }));
			$box.find('.curtain-flatlay-remove').show();
		});
		frame.open();
	});
	// Fabric prefill from the product's material attribute: fills the primary and the blend rows.
	// Nothing is stored until the merchant saves (stretch and drape are still theirs to fill in).
	$(document).on('click', '.curtain-fabric-prefill-use', function (e) {
		e.preventDefault();
		var $note = $(this).closest('.curtain-fabric-prefill');
		var prefill;
		try { prefill = JSON.parse($note.attr('data-prefill') || '{}'); } catch (err) { return; }
		var $box = $note.closest('.curtain-box');
		$box.find('input[name="curtain[fabric_primary]"]').val(prefill.primary || '');
		var blend = Array.isArray(prefill.blend) ? prefill.blend : [];
		var $table = $box.find('.curtain-repeater[data-repeater="fabric_blend"]');
		if (blend.length && $table.length) {
			var $rows = $table.find('tbody tr');
			$rows.slice(1).remove();
			var $template = $rows.first();
			$template.find('input').val('');
			blend.forEach(function (row, i) {
				var $row = i === 0 ? $template : $template.clone();
				$row.find('input').eq(0).val(row[0]);
				$row.find('input').eq(1).val(row[1]);
				if (i > 0) $table.find('tbody').append($row);
			});
			renumber($table);
		}
		$note.remove();
		$box.find('input[name="curtain[fabric_stretch_pct]"]').trigger('focus');
	});

	// Size chart template (assets/chart-templates.json from @curtain/schema): a body template fills
	// sizes and numbers, a garment template fills the size labels and leaves the numbers to measure.
	$(document).on('change', '.curtain-template-select', function () {
		var id = this.value;
		var t = (curtainAdmin.templates || []).filter(function (x) { return x.id === id; })[0];
		var $note = $(this).closest('.curtain-template').find('.curtain-template-note');
		if (!$note.data('default')) $note.data('default', $note.text());
		$note.text(t ? t.description + (t.kind === 'garment' ? ' ' + curtainAdmin.measureNote : '') : $note.data('default'));
	});
	$(document).on('click', '.curtain-template-apply', function (e) {
		e.preventDefault();
		var $wrap = $(this).closest('.curtain-template');
		var id = $wrap.find('.curtain-template-select').val();
		var t = (curtainAdmin.templates || []).filter(function (x) { return x.id === id; })[0];
		if (!t) return;
		var $box = $wrap.closest('.curtain-box');
		var $table = $box.find('.curtain-repeater[data-repeater="size_chart"]');
		var $rows = $table.find('tbody tr');
		var filled = $rows.find('input').filter(function () { return this.value !== ''; }).length > 0;
		if (filled && !window.confirm(curtainAdmin.replaceChart)) return;
		$box.find('input[name="curtain[size_chart_type]"][value="' + t.kind + '"]').prop('checked', true).trigger('change');
		var $template = $rows.first().clone();
		$template.find('input').val('');
		$table.find('tbody').empty();
		t.sizes.forEach(function (size) {
			var $row = $template.clone();
			var data = t.kind === 'body' ? (t.rows || []).filter(function (r) { return r.size === size; })[0] || { size: size } : { size: size };
			$row.find('input').each(function () {
				var m = /\[([a-zA-Z]+)\]$/.exec(this.getAttribute('name') || '');
				if (m && data[m[1]] !== undefined && data[m[1]] !== null) this.value = String(data[m[1]]);
			});
			$table.find('tbody').append($row);
		});
		renumber($table);
		if (t.kind === 'garment' && t.points && t.points.length) {
			$table.find('tbody tr').first().find('input[name$="[' + t.points[0] + ']"]').trigger('focus');
		}
	});

	$(document).on('click', '.curtain-flatlay-remove', function (e) {
		e.preventDefault();
		var $box = $(this).closest('.curtain-flatlay');
		$box.find('.curtain-flatlay-id').val('0');
		$box.find('.curtain-flatlay-preview').empty();
		$(this).hide();
	});
})(jQuery);
