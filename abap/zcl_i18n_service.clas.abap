CLASS zcl_i18n_service DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_service_extension.
  PRIVATE SECTION.
    TYPES: BEGIN OF ty_response,
             status TYPE i,
             json   TYPE string,
           END OF ty_response.
    METHODS build_error
      IMPORTING iv_code    TYPE string
                iv_message TYPE string
      RETURNING VALUE(rs_response) TYPE ty_response.
    METHODS build_success
      IMPORTING iv_data TYPE string
      RETURNING VALUE(rs_response) TYPE ty_response.
    METHODS handle_get_translation
      IMPORTING iv_params TYPE string
      RETURNING VALUE(rs_response) TYPE ty_response.
    METHODS handle_set_translation
      IMPORTING iv_params TYPE string
      RETURNING VALUE(rs_response) TYPE ty_response.
    METHODS handle_list_languages
      IMPORTING iv_params TYPE string
      RETURNING VALUE(rs_response) TYPE ty_response.
    METHODS handle_compare_translations
      IMPORTING iv_params TYPE string
      RETURNING VALUE(rs_response) TYPE ty_response.
    METHODS handle_list_texts
      IMPORTING iv_params TYPE string
      RETURNING VALUE(rs_response) TYPE ty_response.
    METHODS parse_string_array
      IMPORTING iv_content TYPE string
      RETURNING VALUE(rt_values) TYPE string_table.
    METHODS append_text_entry
      IMPORTING iv_json      TYPE string
                iv_attribute TYPE string
                iv_value     TYPE string
      RETURNING VALUE(rv_json) TYPE string.
    METHODS get_de_text_attr
      IMPORTING iv_name TYPE string
      RETURNING VALUE(ro_attr) TYPE REF TO cl_xco_dtel_text_attribute.
    METHODS get_dd_entity_attr
      IMPORTING iv_name TYPE string
      RETURNING VALUE(ro_attr) TYPE REF TO cl_xco_ddef_ent_text_attribute.
    METHODS get_ddls_field_attr
      IMPORTING iv_name TYPE string
      RETURNING VALUE(ro_attr) TYPE REF TO cl_xco_ddef_fld_text_attribute.
    METHODS get_me_field_attr
      IMPORTING iv_name     TYPE string
                iv_position TYPE i DEFAULT 1
      RETURNING VALUE(ro_attr) TYPE REF TO cl_xco_me_fld_text_attribute.
    METHODS get_cds_field_names
      IMPORTING iv_object_name TYPE string
      RETURNING VALUE(rt_names) TYPE string_table.
    METHODS resolve_original_language
      IMPORTING iv_target_type TYPE string
                iv_object_name TYPE string
                iv_pool_type   TYPE string OPTIONAL
      RETURNING VALUE(rv_spras) TYPE spras.
    METHODS iso_from_sap
      IMPORTING iv_spras      TYPE spras
      RETURNING VALUE(rv_iso) TYPE string.
    METHODS build_text_json_entry
      IMPORTING iv_level      TYPE string
                iv_field_name TYPE string
                iv_attribute  TYPE string
                iv_value      TYPE string
      RETURNING VALUE(rv_json) TYPE string.
    METHODS map_me_attr_to_anno
      IMPORTING iv_attr_name TYPE string
      RETURNING VALUE(rv_anno) TYPE string.
    METHODS count_ddlx_positions
      IMPORTING iv_source     TYPE string
                iv_field_name TYPE string
                iv_anno_name  TYPE string
      RETURNING VALUE(rv_count) TYPE i.
    " ── JSON / param helpers (inlined, formerly zcl_vsp_utils) ──────────
    CLASS-METHODS escape_json
      IMPORTING iv_string         TYPE string
      RETURNING VALUE(rv_escaped) TYPE string.
    CLASS-METHODS extract_param
      IMPORTING iv_params       TYPE string
                iv_name         TYPE string
      RETURNING VALUE(rv_value) TYPE string.
    CLASS-METHODS json_obj
      IMPORTING iv_content     TYPE string
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS json_str
      IMPORTING iv_key         TYPE string
                iv_value       TYPE string
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS json_bool
      IMPORTING iv_key         TYPE string
                iv_value       TYPE abap_bool
      RETURNING VALUE(rv_json) TYPE string.
    CLASS-METHODS json_join
      IMPORTING it_parts       TYPE string_table
      RETURNING VALUE(rv_json) TYPE string.
ENDCLASS.

CLASS zcl_i18n_service IMPLEMENTATION.

  METHOD if_http_service_extension~handle_request.

    DATA(lv_path) = request->get_header_field( i_name = '~path_info' ).
    DATA lv_action TYPE string.
    lv_action = lv_path.
    DATA lv_pos TYPE i.
    DO.
      FIND '/' IN lv_action MATCH OFFSET lv_pos.
      IF sy-subrc = 0.
        lv_action = substring( val = lv_action off = lv_pos + 1 ).
      ELSE.
        EXIT.
      ENDIF.
    ENDDO.
    DATA(lv_params) = request->get_text( ).
    DATA ls_response TYPE ty_response.
    CASE lv_action.
      WHEN 'get_translation'.      ls_response = handle_get_translation( lv_params ).
      WHEN 'set_translation'.      ls_response = handle_set_translation( lv_params ).
      WHEN 'list_languages'.       ls_response = handle_list_languages( lv_params ).
      WHEN 'compare_translations'. ls_response = handle_compare_translations( lv_params ).
      WHEN 'list_texts'.           ls_response = handle_list_texts( lv_params ).
      WHEN OTHERS.
        ls_response = build_error( iv_code = 'UNKNOWN_ACTION' iv_message = |Action '{ lv_action }' is not supported| ).
    ENDCASE.
    response->set_header_field( i_name = 'Content-Type' i_value = 'application/json' ).
    response->set_status( i_code = ls_response-status i_reason = '' ).
    response->set_text( i_text = ls_response-json ).

  ENDMETHOD.

  METHOD build_error.

    rs_response-status = 400.
    rs_response-json = json_obj( json_join( VALUE #(
      ( json_bool( iv_key = 'success' iv_value = abap_false ) )
      ( |"error":{ json_obj( json_join( VALUE #(
          ( json_str( iv_key = 'code'    iv_value = iv_code ) )
          ( json_str( iv_key = 'message' iv_value = iv_message ) )
        ) ) ) }| )
    ) ) ).

  ENDMETHOD.

  METHOD build_success.
    rs_response-status = 200.
    rs_response-json = json_obj( json_join( VALUE #(
      ( json_bool( iv_key = 'success' iv_value = abap_true ) )
      ( |"data":{ iv_data }| )
    ) ) ).
  ENDMETHOD.

  METHOD handle_get_translation.
    DATA(lv_target_type) = extract_param( iv_params = iv_params iv_name = 'target_type' ).
    DATA(lv_object_name) = extract_param( iv_params = iv_params iv_name = 'object_name' ).
    DATA(lv_language)    = extract_param( iv_params = iv_params iv_name = 'language' ).
    DATA(lv_field_name)  = extract_param( iv_params = iv_params iv_name = 'field_name' ).
    DATA(lv_fixed_value) = extract_param( iv_params = iv_params iv_name = 'fixed_value' ).
    DATA(lv_msg_number)  = extract_param( iv_params = iv_params iv_name = 'message_number' ).
    DATA(lv_text_sym_id) = extract_param( iv_params = iv_params iv_name = 'text_symbol_id' ).
    DATA(lv_pool_type)   = extract_param( iv_params = iv_params iv_name = 'text_pool_owner_type' ).
    DATA(lv_subobj_name) = extract_param( iv_params = iv_params iv_name = 'subobject_name' ).
    DATA(lv_position_s)  = extract_param( iv_params = iv_params iv_name = 'position' ).
    IF lv_target_type IS INITIAL OR lv_object_name IS INITIAL OR lv_language IS INITIAL.
      rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'target_type, object_name, and language are required' ). RETURN.
    ENDIF.
    TRANSLATE lv_object_name TO UPPER CASE. TRANSLATE lv_language TO UPPER CASE.
    DATA(lv_position) = 1.
    IF lv_position_s IS NOT INITIAL. lv_position = CONV i( lv_position_s ). ENDIF.
    TRY.
        DATA(lo_language) = xco_cp=>language( CONV spras( lv_language ) ).
        DATA lv_json TYPE string.
        CASE lv_target_type.
          WHEN 'data_element'.
            DATA(lo_de) = xco_i18n=>target->data_element->object( CONV sxco_ad_object_name( lv_object_name ) ).
            DATA lt_dtel_attrs TYPE sxco_t_dtel_text_attributes. DATA lo_de_ta TYPE REF TO cl_xco_dtel_text_attribute.
            DATA lt_de_names TYPE string_table.
            APPEND 'short_field_label' TO lt_de_names. APPEND 'medium_field_label' TO lt_de_names.
            APPEND 'long_field_label' TO lt_de_names. APPEND 'heading_field_label' TO lt_de_names.
            LOOP AT lt_de_names INTO DATA(lv_de_name).
              lo_de_ta = get_de_text_attr( lv_de_name ). IF lo_de_ta IS BOUND. APPEND lo_de_ta TO lt_dtel_attrs. ENDIF.
            ENDLOOP.
            DATA(lo_de_result) = lo_de->get_translation( io_language = lo_language it_text_attributes = lt_dtel_attrs ).
            DATA(lv_de_idx) = 0.
            LOOP AT lo_de_result->texts INTO DATA(lo_de_text).
              lv_de_idx = lv_de_idx + 1. READ TABLE lt_de_names INDEX lv_de_idx INTO DATA(lv_de_attr_name).
              lv_json = append_text_entry( iv_json = lv_json iv_attribute = lv_de_attr_name iv_value = lo_de_text->get_string_value( ) ).
            ENDLOOP.
          WHEN 'domain'.
            IF lv_fixed_value IS INITIAL. rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'fixed_value is required for domain get_translation' ). RETURN. ENDIF.
            DATA(lo_dom) = xco_i18n=>target->domain->fixed_value( iv_domain_name = CONV sxco_ad_object_name( lv_object_name ) iv_lower_limit = CONV if_xco_domain_fixed_value=>tv_lower_limit( lv_fixed_value ) ).
            DATA lt_dom_attrs TYPE sxco_t_domain_text_attributes. APPEND xco_cp_domain=>text_attribute->fixed_value_description TO lt_dom_attrs.
            DATA(lo_dom_result) = lo_dom->get_translation( io_language = lo_language it_text_attributes = lt_dom_attrs ).
            IF lo_dom_result->texts IS NOT INITIAL. lv_json = append_text_entry( iv_json = lv_json iv_attribute = 'fixed_value_description' iv_value = lo_dom_result->texts[ 1 ]->get_string_value( ) ). ENDIF.
          WHEN 'data_definition'.
            IF lv_field_name IS INITIAL.
              DATA(lo_ent_get) = xco_i18n=>target->data_definition->entity( CONV sxco_cds_object_name( lv_object_name ) ).
              DATA lt_ent_attr_names TYPE string_table.
              APPEND 'endusertext_label' TO lt_ent_attr_names. APPEND 'ui_headerinfo_description_label' TO lt_ent_attr_names.
              APPEND 'ui_headerinfo_title_label' TO lt_ent_attr_names. APPEND 'ui_headerinfo_typename' TO lt_ent_attr_names.
              APPEND 'ui_headerinfo_typenameplural' TO lt_ent_attr_names.
              DATA lo_ent_ta TYPE REF TO cl_xco_ddef_ent_text_attribute. DATA lv_ent_val TYPE string.
              LOOP AT lt_ent_attr_names INTO DATA(lv_ent_attr_name).
                lo_ent_ta = get_dd_entity_attr( lv_ent_attr_name ). CLEAR lv_ent_val.
                IF lo_ent_ta IS BOUND.
                  DATA lt_ent_attrs TYPE sxco_t_ddef_ent_text_attributs. CLEAR lt_ent_attrs. APPEND lo_ent_ta TO lt_ent_attrs.
                  TRY. DATA(lo_ent_result) = lo_ent_get->get_translation( io_language = lo_language it_text_attributes = lt_ent_attrs ).
                      IF lo_ent_result->texts IS NOT INITIAL. lv_ent_val = lo_ent_result->texts[ 1 ]->get_string_value( ). ENDIF.
                    CATCH cx_root. ENDTRY.
                ENDIF.
                lv_json = append_text_entry( iv_json = lv_json iv_attribute = lv_ent_attr_name iv_value = lv_ent_val ).
              ENDLOOP.
            ELSE.
              TRANSLATE lv_field_name TO LOWER CASE.
              DATA(lo_fld) = xco_i18n=>target->data_definition->field( iv_entity_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_field_name ) ).
              DATA lt_fld_attrs TYPE sxco_t_ddef_fld_text_attributs. DATA lt_fld_names TYPE string_table.
              APPEND 'endusertext_label' TO lt_fld_names. APPEND 'endusertext_quickinfo' TO lt_fld_names.
              DATA lo_fld_ta TYPE REF TO cl_xco_ddef_fld_text_attribute. DATA lv_fld_val TYPE string.
              LOOP AT lt_fld_names INTO DATA(lv_fld_name).
                lo_fld_ta = get_ddls_field_attr( lv_fld_name ). CLEAR lv_fld_val.
                IF lo_fld_ta IS BOUND. CLEAR lt_fld_attrs. APPEND lo_fld_ta TO lt_fld_attrs.
                  TRY. DATA(lo_fld_result) = lo_fld->get_translation( io_language = lo_language it_text_attributes = lt_fld_attrs ).
                      IF lo_fld_result->texts IS NOT INITIAL. lv_fld_val = lo_fld_result->texts[ 1 ]->get_string_value( ). ENDIF.
                    CATCH cx_root. ENDTRY.
                ENDIF.
                lv_json = append_text_entry( iv_json = lv_json iv_attribute = lv_fld_name iv_value = lv_fld_val ).
              ENDLOOP.
            ENDIF.
          WHEN 'message_class'.
            IF lv_msg_number IS INITIAL. rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'message_number is required for message_class get_translation' ). RETURN. ENDIF.
            DATA(lo_mc) = xco_i18n=>target->message_class->message( iv_message_class_name = CONV sxco_mc_object_name( lv_object_name ) iv_message_number = CONV if_xco_mc_message=>tv_number( lv_msg_number ) ).
            DATA lt_mc_attrs TYPE sxco_t_mc_text_attributes. APPEND xco_cp_message_class=>text_attribute->message_short_text TO lt_mc_attrs.
            DATA(lo_mc_result) = lo_mc->get_translation( io_language = lo_language it_text_attributes = lt_mc_attrs ).
            IF lo_mc_result->texts IS NOT INITIAL. lv_json = append_text_entry( iv_json = lv_json iv_attribute = 'message_short_text' iv_value = lo_mc_result->texts[ 1 ]->get_string_value( ) ). ENDIF.
          WHEN 'text_pool'.
            IF lv_text_sym_id IS INITIAL. rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'text_symbol_id is required for text_pool get_translation' ). RETURN. ENDIF.
            DATA lt_tp_attrs TYPE sxco_t_tp_text_attributes. APPEND xco_cp_text_pool=>text_attribute->text_element_text TO lt_tp_attrs.
            IF lv_pool_type = 'function_group'.
              DATA(lo_fg) = xco_i18n=>target->text_pool->function_group_text_symbol( iv_function_group_name = CONV sxco_fg_object_name( lv_object_name ) iv_text_symbol_id = CONV if_xco_i18n_tp_target_factory=>tv_text_symbol_id( lv_text_sym_id ) ).
              DATA(lo_fg_result) = lo_fg->get_translation( io_language = lo_language it_text_attributes = lt_tp_attrs ).
              IF lo_fg_result->texts IS NOT INITIAL. lv_json = append_text_entry( iv_json = lv_json iv_attribute = 'text_element_text' iv_value = lo_fg_result->texts[ 1 ]->get_string_value( ) ). ENDIF.
            ELSE.
              DATA(lo_cls) = xco_i18n=>target->text_pool->class_text_symbol( iv_class_name = CONV sxco_ao_object_name( lv_object_name ) iv_text_symbol_id = CONV if_xco_i18n_tp_target_factory=>tv_text_symbol_id( lv_text_sym_id ) ).
              DATA(lo_cls_result) = lo_cls->get_translation( io_language = lo_language it_text_attributes = lt_tp_attrs ).
              IF lo_cls_result->texts IS NOT INITIAL. lv_json = append_text_entry( iv_json = lv_json iv_attribute = 'text_element_text' iv_value = lo_cls_result->texts[ 1 ]->get_string_value( ) ). ENDIF.
            ENDIF.
          WHEN 'metadata_extension'.
            IF lv_field_name IS INITIAL. rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'field_name is required for metadata_extension get_translation' ). RETURN. ENDIF.
            DATA(lo_me) = xco_i18n=>target->metadata_extension->field( iv_metadata_extension_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_field_name ) ).
            DATA lt_me_attrs TYPE sxco_t_me_fld_text_attributes. DATA lt_me_attr_names TYPE string_table.
            APPEND 'endusertext_label' TO lt_me_attr_names. APPEND 'endusertext_quickinfo' TO lt_me_attr_names.
            APPEND 'ui_lineitem_label' TO lt_me_attr_names. APPEND 'ui_identification_label' TO lt_me_attr_names.
            APPEND 'consumption_dynamiclabel_label' TO lt_me_attr_names. APPEND 'ui_fieldgroup_label' TO lt_me_attr_names.
            APPEND 'ui_fieldgroup_grouplabel' TO lt_me_attr_names. APPEND 'ui_facet_label' TO lt_me_attr_names.
            APPEND 'consumption_valuehelpdef_label' TO lt_me_attr_names.
            DATA lo_me_ta TYPE REF TO cl_xco_me_fld_text_attribute. DATA lv_me_val TYPE string.
            LOOP AT lt_me_attr_names INTO DATA(lv_me_attr_name).
              lo_me_ta = get_me_field_attr( iv_name = lv_me_attr_name iv_position = lv_position ). CLEAR lv_me_val.
              IF lo_me_ta IS BOUND. CLEAR lt_me_attrs. APPEND lo_me_ta TO lt_me_attrs.
                TRY. DATA(lo_me_result) = lo_me->get_translation( io_language = lo_language it_text_attributes = lt_me_attrs ).
                    IF lo_me_result->texts IS NOT INITIAL. lv_me_val = lo_me_result->texts[ 1 ]->get_string_value( ). ENDIF.
                  CATCH cx_root. ENDTRY.
              ENDIF.
              lv_json = append_text_entry( iv_json = lv_json iv_attribute = lv_me_attr_name iv_value = lv_me_val ).
            ENDLOOP.
          WHEN 'application_log_object'.
            IF lv_subobj_name IS NOT INITIAL.
              TRANSLATE lv_subobj_name TO UPPER CASE.
              DATA(lo_aplo_sub) = xco_i18n=>target->application_log_object->subobject( iv_object_name = CONV sxco_aplo_object_name( lv_object_name ) iv_subobject_name = CONV if_xco_aplo_subobject=>tv_name( lv_subobj_name ) ).
              DATA lt_aplo_sub_attrs TYPE sxco_t_aplo_subobj_txt_attrbts.
              APPEND xco_cp_application_log_object=>text_attribute->subobject->short_description TO lt_aplo_sub_attrs.
              DATA(lo_aplo_sub_res) = lo_aplo_sub->get_translation( io_language = lo_language it_text_attributes = lt_aplo_sub_attrs ).
              IF lo_aplo_sub_res->texts IS NOT INITIAL. lv_json = append_text_entry( iv_json = lv_json iv_attribute = 'short_description' iv_value = lo_aplo_sub_res->texts[ 1 ]->get_string_value( ) ). ENDIF.
            ELSE.
              DATA(lo_aplo_obj) = xco_i18n=>target->application_log_object->object( iv_name = CONV sxco_aplo_object_name( lv_object_name ) ).
              DATA lt_aplo_obj_attrs TYPE sxco_t_aplo_obj_text_attribts.
              APPEND xco_cp_application_log_object=>text_attribute->object->short_description TO lt_aplo_obj_attrs.
              DATA(lo_aplo_obj_res) = lo_aplo_obj->get_translation( io_language = lo_language it_text_attributes = lt_aplo_obj_attrs ).
              IF lo_aplo_obj_res->texts IS NOT INITIAL. lv_json = append_text_entry( iv_json = lv_json iv_attribute = 'short_description' iv_value = lo_aplo_obj_res->texts[ 1 ]->get_string_value( ) ). ENDIF.
            ENDIF.
          WHEN 'business_configuration_object'.
            DATA(lo_bco) = xco_i18n=>target->business_configuration_object->object( iv_name = CONV sxco_bco_name( lv_object_name ) ).
            DATA lt_bco_attrs TYPE sxco_t_bco_text_attributes. APPEND xco_cp_business_cnfgrtn_object=>text_attribute->description TO lt_bco_attrs.
            DATA(lo_bco_result) = lo_bco->get_translation( io_language = lo_language it_text_attributes = lt_bco_attrs ).
            IF lo_bco_result->texts IS NOT INITIAL. lv_json = append_text_entry( iv_json = lv_json iv_attribute = 'description' iv_value = lo_bco_result->texts[ 1 ]->get_string_value( ) ). ENDIF.
          WHEN OTHERS.
            rs_response = build_error( iv_code = 'UNSUPPORTED_TARGET' iv_message = |get_translation: target_type '{ lv_target_type }' is not supported| ). RETURN.
        ENDCASE.
        DATA(lv_data) = json_obj( json_join( VALUE #(
          ( json_str( iv_key = 'target_type' iv_value = lv_target_type ) )
          ( json_str( iv_key = 'object_name' iv_value = lv_object_name ) )
          ( json_str( iv_key = 'language' iv_value = lv_language ) )
          ( |"texts":[{ lv_json }]| )
        ) ) ).
        rs_response = build_success( iv_data = lv_data ).
      CATCH cx_root INTO DATA(lx_error).
        rs_response = build_error( iv_code = 'I18N_GET_ERROR' iv_message = lx_error->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD handle_set_translation.
    DATA(lv_target_type) = extract_param( iv_params = iv_params iv_name = 'target_type' ).
    DATA(lv_object_name) = extract_param( iv_params = iv_params iv_name = 'object_name' ).
    DATA(lv_language)    = extract_param( iv_params = iv_params iv_name = 'language' ).
    DATA(lv_transport)   = extract_param( iv_params = iv_params iv_name = 'transport' ).
    DATA(lv_field_name)  = extract_param( iv_params = iv_params iv_name = 'field_name' ).
    DATA(lv_fixed_value) = extract_param( iv_params = iv_params iv_name = 'fixed_value' ).
    DATA(lv_msg_number)  = extract_param( iv_params = iv_params iv_name = 'message_number' ).
    DATA(lv_text_sym_id) = extract_param( iv_params = iv_params iv_name = 'text_symbol_id' ).
    DATA(lv_pool_type)   = extract_param( iv_params = iv_params iv_name = 'text_pool_owner_type' ).
    DATA(lv_subobj_name) = extract_param( iv_params = iv_params iv_name = 'subobject_name' ).
    DATA(lv_position_s)  = extract_param( iv_params = iv_params iv_name = 'position' ).
    IF lv_target_type IS INITIAL OR lv_object_name IS INITIAL OR lv_language IS INITIAL OR lv_transport IS INITIAL.
      rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'target_type, object_name, language, and transport are required' ). RETURN.
    ENDIF.
    TRANSLATE lv_object_name TO UPPER CASE. TRANSLATE lv_language TO UPPER CASE. TRANSLATE lv_transport TO UPPER CASE.
    DATA(lv_position) = 1. IF lv_position_s IS NOT INITIAL. lv_position = CONV i( lv_position_s ). ENDIF.
    FIND PCRE '"texts"\s*:\s*(\[[^\]]*\])' IN iv_params SUBMATCHES DATA(lv_texts_str).
    IF sy-subrc <> 0 OR lv_texts_str IS INITIAL. rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'texts array is required' ). RETURN. ENDIF.
    DATA lt_attrs TYPE string_table. DATA lt_vals TYPE string_table.
    FIND ALL OCCURRENCES OF PCRE '\{[^}]+\}' IN lv_texts_str RESULTS DATA(lt_obj_matches).
    LOOP AT lt_obj_matches INTO DATA(ls_obj_match).
      DATA(lv_obj_json) = lv_texts_str+ls_obj_match-offset(ls_obj_match-length).
      APPEND extract_param( iv_params = lv_obj_json iv_name = 'attribute' ) TO lt_attrs.
      APPEND extract_param( iv_params = lv_obj_json iv_name = 'value' ) TO lt_vals.
    ENDLOOP.
    IF lt_attrs IS INITIAL. rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'texts array is empty or could not be parsed' ). RETURN. ENDIF.
    DATA lv_attr TYPE string. DATA lv_val TYPE string.
    TRY.
        DATA(lo_language) = xco_cp=>language( CONV spras( lv_language ) ).
        DATA(lo_change_scenario) = xco_cp_cts=>transport->for( CONV #( lv_transport ) ).
        CASE lv_target_type.
          WHEN 'data_element'.
            DATA(lo_de_set) = xco_i18n=>target->data_element->object( CONV sxco_ad_object_name( lv_object_name ) ).
            DATA lt_dtel_texts TYPE sxco_t_dtel_texts. DATA lo_de_ta_w TYPE REF TO cl_xco_dtel_text_attribute.
            DO lines( lt_attrs ) TIMES. DATA(lv_idx_de) = sy-index.
              READ TABLE lt_attrs INDEX lv_idx_de INTO lv_attr. READ TABLE lt_vals INDEX lv_idx_de INTO lv_val.
              lo_de_ta_w = get_de_text_attr( lv_attr ).
              IF lo_de_ta_w IS BOUND. DATA(lo_de_tv) = CAST if_xco_i18n_text_attribute( lo_de_ta_w )->get_text_for_string( lv_val ). APPEND lo_de_ta_w->create_text( io_value = lo_de_tv ) TO lt_dtel_texts. ENDIF.
            ENDDO.
            IF lt_dtel_texts IS INITIAL. rs_response = build_error( iv_code = 'INVALID_ATTRS' iv_message = |No valid text attributes found for target_type '{ lv_target_type }'| ). RETURN. ENDIF.
            lo_de_set->set_translation( it_texts = lt_dtel_texts io_language = lo_language io_change_scenario = lo_change_scenario ).
          WHEN 'domain'.
            DATA(lo_dom_set) = xco_i18n=>target->domain->fixed_value( iv_domain_name = CONV sxco_ad_object_name( lv_object_name ) iv_lower_limit = CONV if_xco_domain_fixed_value=>tv_lower_limit( lv_fixed_value ) ).
            DATA lt_dom_texts TYPE sxco_t_domain_texts.
            DATA(lo_dom_ta_w) = xco_cp_domain=>text_attribute->fixed_value_description.
            DO lines( lt_attrs ) TIMES. READ TABLE lt_vals INDEX sy-index INTO lv_val.
              DATA(lo_dom_tv) = CAST if_xco_i18n_text_attribute( lo_dom_ta_w )->get_text_for_string( lv_val ). APPEND lo_dom_ta_w->create_text( io_value = lo_dom_tv ) TO lt_dom_texts.
            ENDDO.
            lo_dom_set->set_translation( it_texts = lt_dom_texts io_language = lo_language io_change_scenario = lo_change_scenario ).
          WHEN 'data_definition'.
            IF lv_field_name IS INITIAL.
              DATA(lo_ent_set) = xco_i18n=>target->data_definition->entity( CONV sxco_cds_object_name( lv_object_name ) ).
              DATA lt_ent_texts TYPE sxco_t_ddef_ent_texts. DATA lo_ent_ta_w TYPE REF TO cl_xco_ddef_ent_text_attribute.
              DO lines( lt_attrs ) TIMES. DATA(lv_idx_ent) = sy-index.
                READ TABLE lt_attrs INDEX lv_idx_ent INTO lv_attr. READ TABLE lt_vals INDEX lv_idx_ent INTO lv_val.
                lo_ent_ta_w = get_dd_entity_attr( lv_attr ).
                IF lo_ent_ta_w IS BOUND. DATA(lo_ent_tv) = CAST if_xco_i18n_text_attribute( lo_ent_ta_w )->get_text_for_string( lv_val ). APPEND lo_ent_ta_w->create_text( io_value = lo_ent_tv ) TO lt_ent_texts. ENDIF.
              ENDDO.
              IF lt_ent_texts IS INITIAL. rs_response = build_error( iv_code = 'INVALID_ATTRS' iv_message = |No valid entity text attributes found for target_type '{ lv_target_type }'| ). RETURN. ENDIF.
              lo_ent_set->set_translation( io_language = lo_language it_texts = lt_ent_texts io_change_scenario = lo_change_scenario ).
            ELSE.
              TRANSLATE lv_field_name TO LOWER CASE.
              DATA(lo_ddls_set) = xco_i18n=>target->data_definition->field( iv_entity_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_field_name ) ).
              DATA lt_ddls_texts TYPE sxco_t_ddef_fld_texts. DATA lo_fld_ta_w TYPE REF TO cl_xco_ddef_fld_text_attribute.
              DO lines( lt_attrs ) TIMES. DATA(lv_idx_fld) = sy-index.
                READ TABLE lt_attrs INDEX lv_idx_fld INTO lv_attr. READ TABLE lt_vals INDEX lv_idx_fld INTO lv_val.
                lo_fld_ta_w = get_ddls_field_attr( lv_attr ).
                IF lo_fld_ta_w IS BOUND. DATA(lo_fld_tv) = CAST if_xco_i18n_text_attribute( lo_fld_ta_w )->get_text_for_string( lv_val ). APPEND lo_fld_ta_w->create_text( io_value = lo_fld_tv ) TO lt_ddls_texts. ENDIF.
              ENDDO.
              IF lt_ddls_texts IS INITIAL. rs_response = build_error( iv_code = 'INVALID_ATTRS' iv_message = |No valid text attributes found for target_type '{ lv_target_type }'| ). RETURN. ENDIF.
              lo_ddls_set->set_translation( io_language = lo_language it_texts = lt_ddls_texts io_change_scenario = lo_change_scenario ).
            ENDIF.
          WHEN 'message_class'.
            DATA(lo_mc_set) = xco_i18n=>target->message_class->message( iv_message_class_name = CONV sxco_mc_object_name( lv_object_name ) iv_message_number = CONV if_xco_mc_message=>tv_number( lv_msg_number ) ).
            DATA lt_mc_texts TYPE sxco_t_mc_texts. DATA(lo_mc_ta_w) = xco_cp_message_class=>text_attribute->message_short_text.
            DO lines( lt_attrs ) TIMES. READ TABLE lt_vals INDEX sy-index INTO lv_val.
              DATA(lo_mc_tv) = CAST if_xco_i18n_text_attribute( lo_mc_ta_w )->get_text_for_string( lv_val ). APPEND lo_mc_ta_w->create_text( io_value = lo_mc_tv ) TO lt_mc_texts.
            ENDDO.
            lo_mc_set->set_translation( it_texts = lt_mc_texts io_language = lo_language io_change_scenario = lo_change_scenario ).
          WHEN 'text_pool'.
            DATA lt_tp_texts TYPE sxco_t_tp_texts. DATA(lo_tp_ta_w) = xco_cp_text_pool=>text_attribute->text_element_text.
            DO lines( lt_attrs ) TIMES. READ TABLE lt_vals INDEX sy-index INTO lv_val.
              DATA(lo_tp_tv) = CAST if_xco_i18n_text_attribute( lo_tp_ta_w )->get_text_for_string( lv_val ). APPEND lo_tp_ta_w->create_text( io_value = lo_tp_tv ) TO lt_tp_texts.
            ENDDO.
            IF lv_pool_type = 'function_group'.
              DATA(lo_fg_set) = xco_i18n=>target->text_pool->function_group_text_symbol( iv_function_group_name = CONV sxco_fg_object_name( lv_object_name ) iv_text_symbol_id = CONV if_xco_i18n_tp_target_factory=>tv_text_symbol_id( lv_text_sym_id ) ).
              lo_fg_set->set_translation( it_texts = lt_tp_texts io_language = lo_language io_change_scenario = lo_change_scenario ).
            ELSE.
              DATA(lo_cls_set) = xco_i18n=>target->text_pool->class_text_symbol( iv_class_name = CONV sxco_ao_object_name( lv_object_name ) iv_text_symbol_id = CONV if_xco_i18n_tp_target_factory=>tv_text_symbol_id( lv_text_sym_id ) ).
              lo_cls_set->set_translation( it_texts = lt_tp_texts io_language = lo_language io_change_scenario = lo_change_scenario ).
            ENDIF.
          WHEN 'metadata_extension'.
            IF lv_field_name IS INITIAL. rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'field_name is required for metadata_extension set_translation' ). RETURN. ENDIF.
            DATA(lo_me_set) = xco_i18n=>target->metadata_extension->field( iv_metadata_extension_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_field_name ) ).
            DATA lt_me_texts TYPE sxco_t_me_fld_texts. DATA lo_me_ta_w TYPE REF TO cl_xco_me_fld_text_attribute.
            DO lines( lt_attrs ) TIMES. DATA(lv_idx_me) = sy-index.
              READ TABLE lt_attrs INDEX lv_idx_me INTO lv_attr. READ TABLE lt_vals INDEX lv_idx_me INTO lv_val.
              lo_me_ta_w = get_me_field_attr( iv_name = lv_attr iv_position = lv_position ).
              IF lo_me_ta_w IS BOUND. DATA(lo_me_tv) = CAST if_xco_i18n_text_attribute( lo_me_ta_w )->get_text_for_string( lv_val ). APPEND lo_me_ta_w->create_text( io_value = lo_me_tv ) TO lt_me_texts. ENDIF.
            ENDDO.
            IF lt_me_texts IS INITIAL. rs_response = build_error( iv_code = 'INVALID_ATTRS' iv_message = |No valid text attributes found for target_type '{ lv_target_type }'| ). RETURN. ENDIF.
            lo_me_set->set_translation( it_texts = lt_me_texts io_language = lo_language io_change_scenario = lo_change_scenario ).
          WHEN 'application_log_object'.
            IF lv_subobj_name IS NOT INITIAL.
              TRANSLATE lv_subobj_name TO UPPER CASE.
              DATA(lo_set_aplo_sub) = xco_i18n=>target->application_log_object->subobject( iv_object_name = CONV sxco_aplo_object_name( lv_object_name ) iv_subobject_name = CONV if_xco_aplo_subobject=>tv_name( lv_subobj_name ) ).
              DATA lt_aplo_sub_texts TYPE sxco_t_aplo_subobj_texts. DATA(lo_aplo_sub_ta) = xco_cp_application_log_object=>text_attribute->subobject->short_description.
              DO lines( lt_attrs ) TIMES. READ TABLE lt_vals INDEX sy-index INTO lv_val.
                DATA(lo_aplo_sub_tv) = CAST if_xco_i18n_text_attribute( lo_aplo_sub_ta )->get_text_for_string( lv_val ). APPEND lo_aplo_sub_ta->create_text( io_value = lo_aplo_sub_tv ) TO lt_aplo_sub_texts.
              ENDDO.
              lo_set_aplo_sub->set_translation( it_texts = lt_aplo_sub_texts io_language = lo_language io_change_scenario = lo_change_scenario ).
            ELSE.
              DATA(lo_set_aplo_obj) = xco_i18n=>target->application_log_object->object( iv_name = CONV sxco_aplo_object_name( lv_object_name ) ).
              DATA lt_aplo_obj_texts TYPE sxco_t_aplo_obj_texts. DATA(lo_aplo_obj_ta) = xco_cp_application_log_object=>text_attribute->object->short_description.
              DO lines( lt_attrs ) TIMES. READ TABLE lt_vals INDEX sy-index INTO lv_val.
                DATA(lo_aplo_obj_tv) = CAST if_xco_i18n_text_attribute( lo_aplo_obj_ta )->get_text_for_string( lv_val ). APPEND lo_aplo_obj_ta->create_text( io_value = lo_aplo_obj_tv ) TO lt_aplo_obj_texts.
              ENDDO.
              lo_set_aplo_obj->set_translation( it_texts = lt_aplo_obj_texts io_language = lo_language io_change_scenario = lo_change_scenario ).
            ENDIF.
          WHEN 'business_configuration_object'.
            DATA(lo_bco_set) = xco_i18n=>target->business_configuration_object->object( iv_name = CONV sxco_bco_name( lv_object_name ) ).
            DATA lt_bco_texts TYPE sxco_t_bco_texts. DATA(lo_bco_ta_w) = xco_cp_business_cnfgrtn_object=>text_attribute->description.
            DO lines( lt_attrs ) TIMES. READ TABLE lt_vals INDEX sy-index INTO lv_val.
              DATA(lo_bco_tv) = CAST if_xco_i18n_text_attribute( lo_bco_ta_w )->get_text_for_string( lv_val ). APPEND lo_bco_ta_w->create_text( io_value = lo_bco_tv ) TO lt_bco_texts.
            ENDDO.
            lo_bco_set->set_translation( it_texts = lt_bco_texts io_language = lo_language io_change_scenario = lo_change_scenario ).
          WHEN OTHERS.
            rs_response = build_error( iv_code = 'UNSUPPORTED_TARGET' iv_message = |set_translation: target_type '{ lv_target_type }' is not supported| ). RETURN.
        ENDCASE.
        DATA(lv_data) = json_obj( json_join( VALUE #(
          ( json_str( iv_key = 'target_type' iv_value = lv_target_type ) )
          ( json_str( iv_key = 'object_name' iv_value = lv_object_name ) )
          ( json_str( iv_key = 'language' iv_value = lv_language ) )
          ( json_str( iv_key = 'transport' iv_value = lv_transport ) )
          ( json_bool( iv_key = 'success' iv_value = abap_true ) )
        ) ) ).
        rs_response = build_success( iv_data = lv_data ).
      CATCH cx_root INTO DATA(lx_error).
        rs_response = build_error( iv_code = 'I18N_SET_ERROR' iv_message = lx_error->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD handle_list_languages.
    TRY.
        SELECT Language, LanguageISOCode FROM I_Language INTO TABLE @DATA(lt_langs) ORDER BY Language.
        DATA lv_langs_json TYPE string.
        LOOP AT lt_langs INTO DATA(ls_lang).
          DATA(lv_name) = xco_cp=>language( ls_lang-Language )->get_name( ).
          IF lv_langs_json IS NOT INITIAL. lv_langs_json = lv_langs_json && |,|. ENDIF.
          lv_langs_json = lv_langs_json && json_obj( json_join( VALUE #(
            ( json_str( iv_key = 'sap_code' iv_value = CONV string( ls_lang-Language ) ) )
            ( json_str( iv_key = 'iso_code' iv_value = CONV string( ls_lang-LanguageISOCode ) ) )
            ( json_str( iv_key = 'name'     iv_value = CONV string( lv_name ) ) )
          ) ) ).
        ENDLOOP.
        DATA(lv_data) = json_obj( |"languages":[{ lv_langs_json }]| ).
        rs_response = build_success( iv_data = lv_data ).
      CATCH cx_root INTO DATA(lx_error).
        rs_response = build_error( iv_code = 'LANG_ERROR' iv_message = lx_error->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD handle_compare_translations.
    DATA(lv_target_type) = extract_param( iv_params = iv_params iv_name = 'target_type' ).
    DATA(lv_object_name) = extract_param( iv_params = iv_params iv_name = 'object_name' ).
    DATA(lv_source_lang) = extract_param( iv_params = iv_params iv_name = 'source_language' ).
    DATA(lv_target_lang) = extract_param( iv_params = iv_params iv_name = 'target_language' ).
    DATA(lv_position_s)  = extract_param( iv_params = iv_params iv_name = 'position' ).
    DATA lt_fields TYPE string_table. DATA lv_items_json TYPE string.
    IF lv_target_type IS INITIAL OR lv_object_name IS INITIAL OR lv_source_lang IS INITIAL OR lv_target_lang IS INITIAL.
      rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'target_type, object_name, source_language, and target_language are required' ). RETURN.
    ENDIF.
    TRANSLATE lv_object_name TO UPPER CASE. TRANSLATE lv_source_lang TO UPPER CASE. TRANSLATE lv_target_lang TO UPPER CASE.
    DATA(lv_position) = 1. IF lv_position_s IS NOT INITIAL. lv_position = CONV i( lv_position_s ). ENDIF.
    FIND PCRE '"fields"\s*:\s*\[([^\]]*)\]' IN iv_params SUBMATCHES DATA(lv_fields_str).
    IF sy-subrc = 0 AND lv_fields_str IS NOT INITIAL. lt_fields = parse_string_array( lv_fields_str ). ENDIF.
    TRY.
        DATA(lo_src_lang) = xco_cp=>language( CONV spras( lv_source_lang ) ).
        DATA(lo_tgt_lang) = xco_cp=>language( CONV spras( lv_target_lang ) ).
        CASE lv_target_type.
          WHEN 'data_definition'.
            DATA(lo_cmp_ent) = xco_i18n=>target->data_definition->entity( CONV sxco_cds_object_name( lv_object_name ) ).
            DATA lt_cmp_ent_ta TYPE sxco_t_ddef_ent_text_attributs. APPEND xco_cp_data_definition=>text_attribute->entity->endusertext_label TO lt_cmp_ent_ta.
            DATA lv_ent_src TYPE string. DATA lv_ent_tgt TYPE string.
            TRY. DATA(lo_ent_src_r) = lo_cmp_ent->get_translation( io_language = lo_src_lang it_text_attributes = lt_cmp_ent_ta ).
                IF lo_ent_src_r->texts IS NOT INITIAL. lv_ent_src = lo_ent_src_r->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. ENDTRY.
            TRY. DATA(lo_ent_tgt_r) = lo_cmp_ent->get_translation( io_language = lo_tgt_lang it_text_attributes = lt_cmp_ent_ta ).
                IF lo_ent_tgt_r->texts IS NOT INITIAL. lv_ent_tgt = lo_ent_tgt_r->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. ENDTRY.
            IF lv_ent_src IS NOT INITIAL OR lv_ent_tgt IS NOT INITIAL.
              DATA(lv_ent_diff) = xsdbool( lv_ent_src <> lv_ent_tgt OR lv_ent_tgt IS INITIAL ).
              DATA(lv_ent_src_j) = append_text_entry( iv_json = '' iv_attribute = 'endusertext_label' iv_value = lv_ent_src ).
              DATA(lv_ent_tgt_j) = append_text_entry( iv_json = '' iv_attribute = 'endusertext_label' iv_value = lv_ent_tgt ).
              lv_items_json = json_obj( json_join( VALUE #(
                ( json_str( iv_key = 'field_or_key' iv_value = '_entity_' ) )
                ( |"source_texts":[{ lv_ent_src_j }]| ) ( |"target_texts":[{ lv_ent_tgt_j }]| )
                ( json_bool( iv_key = 'has_difference' iv_value = lv_ent_diff ) ) ) ) ).
            ENDIF.
            IF lt_fields IS INITIAL. lt_fields = get_cds_field_names( lv_object_name ). ENDIF.
            DATA lt_cmp_fld_ta TYPE sxco_t_ddef_fld_text_attributs. APPEND xco_cp_data_definition=>text_attribute->field->endusertext_label TO lt_cmp_fld_ta.
            DATA lv_src_lbl TYPE string. DATA lv_tgt_lbl TYPE string.
            LOOP AT lt_fields INTO DATA(lv_field).
              DATA(lv_fld_lower) = lv_field. TRANSLATE lv_fld_lower TO LOWER CASE.
              DATA(lo_cmp_fld) = xco_i18n=>target->data_definition->field( iv_entity_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_fld_lower ) ).
              DATA(lo_cmp_src_t) = lo_cmp_fld->get_translation( io_language = lo_src_lang it_text_attributes = lt_cmp_fld_ta ).
              DATA(lo_cmp_tgt_t) = lo_cmp_fld->get_translation( io_language = lo_tgt_lang it_text_attributes = lt_cmp_fld_ta ).
              CLEAR: lv_src_lbl, lv_tgt_lbl.
              IF lo_cmp_src_t->texts IS NOT INITIAL. lv_src_lbl = lo_cmp_src_t->texts[ 1 ]->get_string_value( ). ENDIF.
              IF lo_cmp_tgt_t->texts IS NOT INITIAL. lv_tgt_lbl = lo_cmp_tgt_t->texts[ 1 ]->get_string_value( ). ENDIF.
              DATA(lv_has_diff) = xsdbool( lv_src_lbl <> lv_tgt_lbl OR lv_tgt_lbl IS INITIAL ).
              DATA(lv_src_json) = append_text_entry( iv_json = '' iv_attribute = 'endusertext_label' iv_value = lv_src_lbl ).
              DATA(lv_tgt_json) = append_text_entry( iv_json = '' iv_attribute = 'endusertext_label' iv_value = lv_tgt_lbl ).
              IF lv_items_json IS NOT INITIAL. lv_items_json = lv_items_json && |,|. ENDIF.
              lv_items_json = lv_items_json && json_obj( json_join( VALUE #(
                ( json_str( iv_key = 'field_or_key' iv_value = lv_field ) )
                ( |"source_texts":[{ lv_src_json }]| ) ( |"target_texts":[{ lv_tgt_json }]| )
                ( json_bool( iv_key = 'has_difference' iv_value = lv_has_diff ) ) ) ) ).
            ENDLOOP.
          WHEN 'data_element'.
            DATA(lo_cmp_de) = xco_i18n=>target->data_element->object( CONV sxco_ad_object_name( lv_object_name ) ).
            DATA lt_cmp_de_attr_names TYPE string_table.
            APPEND 'short_field_label' TO lt_cmp_de_attr_names. APPEND 'medium_field_label' TO lt_cmp_de_attr_names.
            APPEND 'long_field_label' TO lt_cmp_de_attr_names. APPEND 'heading_field_label' TO lt_cmp_de_attr_names.
            DATA lv_src_texts_json TYPE string. DATA lv_tgt_texts_json TYPE string. DATA lv_any_diff TYPE abap_bool VALUE abap_false.
            DATA lo_cmp_de_ta TYPE REF TO cl_xco_dtel_text_attribute. DATA lt_cmp_de_single_ta TYPE sxco_t_dtel_text_attributes.
            DATA lv_src_t TYPE string. DATA lv_tgt_t TYPE string.
            LOOP AT lt_cmp_de_attr_names INTO DATA(lv_cmp_attr).
              lo_cmp_de_ta = get_de_text_attr( lv_cmp_attr ). CHECK lo_cmp_de_ta IS BOUND.
              CLEAR lt_cmp_de_single_ta. APPEND lo_cmp_de_ta TO lt_cmp_de_single_ta.
              DATA(lo_cmp_de_src) = lo_cmp_de->get_translation( io_language = lo_src_lang it_text_attributes = lt_cmp_de_single_ta ).
              DATA(lo_cmp_de_tgt) = lo_cmp_de->get_translation( io_language = lo_tgt_lang it_text_attributes = lt_cmp_de_single_ta ).
              CLEAR: lv_src_t, lv_tgt_t.
              IF lo_cmp_de_src->texts IS NOT INITIAL. lv_src_t = lo_cmp_de_src->texts[ 1 ]->get_string_value( ). ENDIF.
              IF lo_cmp_de_tgt->texts IS NOT INITIAL. lv_tgt_t = lo_cmp_de_tgt->texts[ 1 ]->get_string_value( ). ENDIF.
              IF lv_src_t <> lv_tgt_t OR lv_tgt_t IS INITIAL. lv_any_diff = abap_true. ENDIF.
              lv_src_texts_json = append_text_entry( iv_json = lv_src_texts_json iv_attribute = lv_cmp_attr iv_value = lv_src_t ).
              lv_tgt_texts_json = append_text_entry( iv_json = lv_tgt_texts_json iv_attribute = lv_cmp_attr iv_value = lv_tgt_t ).
            ENDLOOP.
            lv_items_json = json_obj( json_join( VALUE #(
              ( json_str( iv_key = 'field_or_key' iv_value = lv_object_name ) )
              ( |"source_texts":[{ lv_src_texts_json }]| ) ( |"target_texts":[{ lv_tgt_texts_json }]| )
              ( json_bool( iv_key = 'has_difference' iv_value = lv_any_diff ) ) ) ) ).
          WHEN 'metadata_extension'.
            IF lt_fields IS INITIAL. lt_fields = get_cds_field_names( lv_object_name ). ENDIF.
            DATA lt_cmp_me_attr_names TYPE string_table.
            APPEND 'endusertext_label' TO lt_cmp_me_attr_names. APPEND 'endusertext_quickinfo' TO lt_cmp_me_attr_names.
            APPEND 'ui_lineitem_label' TO lt_cmp_me_attr_names. APPEND 'ui_identification_label' TO lt_cmp_me_attr_names.
            APPEND 'consumption_dynamiclabel_label' TO lt_cmp_me_attr_names. APPEND 'ui_fieldgroup_label' TO lt_cmp_me_attr_names.
            APPEND 'ui_fieldgroup_grouplabel' TO lt_cmp_me_attr_names. APPEND 'ui_facet_label' TO lt_cmp_me_attr_names.
            APPEND 'consumption_valuehelpdef_label' TO lt_cmp_me_attr_names.
            DATA lo_cmp_me_ta TYPE REF TO cl_xco_me_fld_text_attribute. DATA lt_cmp_me_single TYPE sxco_t_me_fld_text_attributes.
            DATA lv_cmp_me_src TYPE string. DATA lv_cmp_me_tgt TYPE string.
            LOOP AT lt_fields INTO DATA(lv_me_field).
              DATA(lv_me_src_json) = ||. DATA(lv_me_tgt_json) = ||. DATA(lv_me_any_diff) = abap_false.
              DATA(lo_cmp_me) = xco_i18n=>target->metadata_extension->field( iv_metadata_extension_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_me_field ) ).
              LOOP AT lt_cmp_me_attr_names INTO DATA(lv_cmp_me_attr).
                lo_cmp_me_ta = get_me_field_attr( iv_name = lv_cmp_me_attr iv_position = lv_position ). CHECK lo_cmp_me_ta IS BOUND.
                CLEAR lt_cmp_me_single. APPEND lo_cmp_me_ta TO lt_cmp_me_single. CLEAR: lv_cmp_me_src, lv_cmp_me_tgt.
                TRY. DATA(lo_cmp_me_src_t) = lo_cmp_me->get_translation( io_language = lo_src_lang it_text_attributes = lt_cmp_me_single ).
                    IF lo_cmp_me_src_t->texts IS NOT INITIAL. lv_cmp_me_src = lo_cmp_me_src_t->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. ENDTRY.
                TRY. DATA(lo_cmp_me_tgt_t) = lo_cmp_me->get_translation( io_language = lo_tgt_lang it_text_attributes = lt_cmp_me_single ).
                    IF lo_cmp_me_tgt_t->texts IS NOT INITIAL. lv_cmp_me_tgt = lo_cmp_me_tgt_t->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. ENDTRY.
                IF lv_cmp_me_src <> lv_cmp_me_tgt OR lv_cmp_me_tgt IS INITIAL. lv_me_any_diff = abap_true. ENDIF.
                lv_me_src_json = append_text_entry( iv_json = lv_me_src_json iv_attribute = lv_cmp_me_attr iv_value = lv_cmp_me_src ).
                lv_me_tgt_json = append_text_entry( iv_json = lv_me_tgt_json iv_attribute = lv_cmp_me_attr iv_value = lv_cmp_me_tgt ).
              ENDLOOP.
              IF lv_items_json IS NOT INITIAL. lv_items_json = lv_items_json && |,|. ENDIF.
              lv_items_json = lv_items_json && json_obj( json_join( VALUE #(
                ( json_str( iv_key = 'field_or_key' iv_value = lv_me_field ) )
                ( |"source_texts":[{ lv_me_src_json }]| ) ( |"target_texts":[{ lv_me_tgt_json }]| )
                ( json_bool( iv_key = 'has_difference' iv_value = lv_me_any_diff ) ) ) ) ).
            ENDLOOP.
          WHEN 'domain'.
            SELECT domvalue_l FROM dd07l WHERE domname = @lv_object_name AND as4local = 'A' ORDER BY valpos INTO TABLE @DATA(lt_cmp_dom_fvs).
            DATA lt_cmp_dom_a TYPE sxco_t_domain_text_attributes. APPEND xco_cp_domain=>text_attribute->fixed_value_description TO lt_cmp_dom_a.
            LOOP AT lt_cmp_dom_fvs INTO DATA(ls_cmp_dom_fv).
              DATA(lo_cmp_dom) = xco_i18n=>target->domain->fixed_value( iv_domain_name = CONV sxco_ad_object_name( lv_object_name ) iv_lower_limit = ls_cmp_dom_fv-domvalue_l ).
              DATA lv_dom_src TYPE string. DATA lv_dom_tgt TYPE string. CLEAR: lv_dom_src, lv_dom_tgt.
              TRY. DATA(lo_dom_src_r) = lo_cmp_dom->get_translation( io_language = lo_src_lang it_text_attributes = lt_cmp_dom_a ).
                  IF lo_dom_src_r->texts IS NOT INITIAL. lv_dom_src = lo_dom_src_r->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. ENDTRY.
              TRY. DATA(lo_dom_tgt_r) = lo_cmp_dom->get_translation( io_language = lo_tgt_lang it_text_attributes = lt_cmp_dom_a ).
                  IF lo_dom_tgt_r->texts IS NOT INITIAL. lv_dom_tgt = lo_dom_tgt_r->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. ENDTRY.
              DATA(lv_dom_diff) = xsdbool( lv_dom_src <> lv_dom_tgt OR lv_dom_tgt IS INITIAL ).
              DATA(lv_dom_src_j) = append_text_entry( iv_json = '' iv_attribute = 'fixed_value_description' iv_value = lv_dom_src ).
              DATA(lv_dom_tgt_j) = append_text_entry( iv_json = '' iv_attribute = 'fixed_value_description' iv_value = lv_dom_tgt ).
              IF lv_items_json IS NOT INITIAL. lv_items_json = lv_items_json && |,|. ENDIF.
              lv_items_json = lv_items_json && json_obj( json_join( VALUE #(
                ( json_str( iv_key = 'field_or_key' iv_value = CONV string( ls_cmp_dom_fv-domvalue_l ) ) )
                ( |"source_texts":[{ lv_dom_src_j }]| ) ( |"target_texts":[{ lv_dom_tgt_j }]| )
                ( json_bool( iv_key = 'has_difference' iv_value = lv_dom_diff ) ) ) ) ).
            ENDLOOP.
          WHEN 'message_class'.
            SELECT DISTINCT msgnr FROM t100 WHERE arbgb = @lv_object_name ORDER BY msgnr INTO TABLE @DATA(lt_cmp_mc_nums).
            DATA lt_cmp_mc_a TYPE sxco_t_mc_text_attributes. APPEND xco_cp_message_class=>text_attribute->message_short_text TO lt_cmp_mc_a.
            LOOP AT lt_cmp_mc_nums INTO DATA(ls_cmp_mc_num).
              DATA(lo_cmp_mc) = xco_i18n=>target->message_class->message( iv_message_class_name = CONV sxco_mc_object_name( lv_object_name ) iv_message_number = CONV if_xco_mc_message=>tv_number( ls_cmp_mc_num-msgnr ) ).
              DATA lv_mc_src TYPE string. DATA lv_mc_tgt TYPE string. CLEAR: lv_mc_src, lv_mc_tgt.
              TRY. DATA(lo_mc_src_r) = lo_cmp_mc->get_translation( io_language = lo_src_lang it_text_attributes = lt_cmp_mc_a ).
                  IF lo_mc_src_r->texts IS NOT INITIAL. lv_mc_src = lo_mc_src_r->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. ENDTRY.
              TRY. DATA(lo_mc_tgt_r) = lo_cmp_mc->get_translation( io_language = lo_tgt_lang it_text_attributes = lt_cmp_mc_a ).
                  IF lo_mc_tgt_r->texts IS NOT INITIAL. lv_mc_tgt = lo_mc_tgt_r->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. ENDTRY.
              DATA(lv_mc_diff) = xsdbool( lv_mc_src <> lv_mc_tgt OR lv_mc_tgt IS INITIAL ).
              DATA(lv_mc_src_j) = append_text_entry( iv_json = '' iv_attribute = 'message_short_text' iv_value = lv_mc_src ).
              DATA(lv_mc_tgt_j) = append_text_entry( iv_json = '' iv_attribute = 'message_short_text' iv_value = lv_mc_tgt ).
              IF lv_items_json IS NOT INITIAL. lv_items_json = lv_items_json && |,|. ENDIF.
              lv_items_json = lv_items_json && json_obj( json_join( VALUE #(
                ( json_str( iv_key = 'field_or_key' iv_value = CONV string( ls_cmp_mc_num-msgnr ) ) )
                ( |"source_texts":[{ lv_mc_src_j }]| ) ( |"target_texts":[{ lv_mc_tgt_j }]| )
                ( json_bool( iv_key = 'has_difference' iv_value = lv_mc_diff ) ) ) ) ).
            ENDLOOP.
          WHEN OTHERS.
            rs_response = build_error( iv_code = 'UNSUPPORTED_TARGET' iv_message = |compare_translations: target_type '{ lv_target_type }' not supported. Use: data_element, data_definition, metadata_extension, domain, message_class| ). RETURN.
        ENDCASE.
        DATA(lv_data) = json_obj( json_join( VALUE #(
          ( json_str( iv_key = 'target_type' iv_value = lv_target_type ) )
          ( json_str( iv_key = 'object_name' iv_value = lv_object_name ) )
          ( json_str( iv_key = 'source_language' iv_value = lv_source_lang ) )
          ( json_str( iv_key = 'target_language' iv_value = lv_target_lang ) )
          ( |"items":[{ lv_items_json }]| )
        ) ) ).
        rs_response = build_success( iv_data = lv_data ).
      CATCH cx_root INTO DATA(lx_error).
        rs_response = build_error( iv_code = 'COMPARE_ERROR' iv_message = lx_error->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD handle_list_texts.
    DATA(lv_target_type) = extract_param( iv_params = iv_params iv_name = 'target_type' ).
    DATA(lv_object_name) = extract_param( iv_params = iv_params iv_name = 'object_name' ).
    DATA(lv_language)    = extract_param( iv_params = iv_params iv_name = 'language' ).
    DATA(lv_pool_type)   = extract_param( iv_params = iv_params iv_name = 'text_pool_owner_type' ).
    IF lv_target_type IS INITIAL OR lv_object_name IS INITIAL.
      rs_response = build_error( iv_code = 'MISSING_PARAM' iv_message = 'target_type and object_name are required' ). RETURN.
    ENDIF.
    TRANSLATE lv_object_name TO UPPER CASE.
    " No language supplied -> read in the object's ORIGINAL language (not sy-langu),
    " so GetTexts without a language returns the source texts regardless of logon language.
    DATA(lv_lang_omitted) = xsdbool( lv_language IS INITIAL ).
    IF lv_language IS INITIAL. lv_language = resolve_original_language( iv_target_type = lv_target_type iv_object_name = lv_object_name iv_pool_type = lv_pool_type ). ENDIF. TRANSLATE lv_language TO UPPER CASE.
    TRY.
        DATA(lo_language) = xco_cp=>language( CONV spras( lv_language ) ).
        DATA(lv_orig_spras) = resolve_original_language( iv_target_type = lv_target_type iv_object_name = lv_object_name iv_pool_type = lv_pool_type ).
        DATA(lo_orig_language) = xco_cp=>language( lv_orig_spras ).
        DATA lv_texts_json TYPE string.
        CASE lv_target_type.
          WHEN 'data_element'.
            DATA(lo_lt_de) = xco_i18n=>target->data_element->object( CONV sxco_ad_object_name( lv_object_name ) ).
            DATA lt_lt_de_names TYPE string_table.
            APPEND 'short_field_label' TO lt_lt_de_names. APPEND 'medium_field_label' TO lt_lt_de_names.
            APPEND 'long_field_label' TO lt_lt_de_names. APPEND 'heading_field_label' TO lt_lt_de_names.
            DATA lt_lt_de_attrs TYPE sxco_t_dtel_text_attributes. DATA lo_lt_de_ta TYPE REF TO cl_xco_dtel_text_attribute.
            LOOP AT lt_lt_de_names INTO DATA(lv_lt_de_n).
              lo_lt_de_ta = get_de_text_attr( lv_lt_de_n ). IF lo_lt_de_ta IS BOUND. APPEND lo_lt_de_ta TO lt_lt_de_attrs. ENDIF.
            ENDLOOP.
            DATA(lo_lt_de_r) = lo_lt_de->get_translation( io_language = lo_language it_text_attributes = lt_lt_de_attrs ).
            DATA(lv_lt_de_idx) = 0.
            LOOP AT lo_lt_de_r->texts INTO DATA(lo_lt_de_t).
              lv_lt_de_idx = lv_lt_de_idx + 1. READ TABLE lt_lt_de_names INDEX lv_lt_de_idx INTO DATA(lv_lt_de_an).
              IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
              lv_texts_json = lv_texts_json && json_obj( json_join( VALUE #(
                ( json_str( iv_key = 'level' iv_value = 'entity' ) )
                ( json_str( iv_key = 'field_name' iv_value = '' ) )
                ( json_str( iv_key = 'attribute' iv_value = lv_lt_de_an ) )
                ( json_str( iv_key = 'value' iv_value = lo_lt_de_t->get_string_value( ) ) ) ) ) ).
            ENDLOOP.
          WHEN 'domain'.
            SELECT domvalue_l FROM dd07l WHERE domname = @lv_object_name AND as4local = 'A' ORDER BY valpos INTO TABLE @DATA(lt_lt_dom_fvs).
            LOOP AT lt_lt_dom_fvs INTO DATA(ls_lt_dom_fv).
              DATA(lo_lt_dom) = xco_i18n=>target->domain->fixed_value( iv_domain_name = CONV sxco_ad_object_name( lv_object_name ) iv_lower_limit = ls_lt_dom_fv-domvalue_l ).
              DATA lt_lt_dom_a TYPE sxco_t_domain_text_attributes. CLEAR lt_lt_dom_a. APPEND xco_cp_domain=>text_attribute->fixed_value_description TO lt_lt_dom_a.
              DATA(lo_lt_dom_r) = lo_lt_dom->get_translation( io_language = lo_language it_text_attributes = lt_lt_dom_a ).
              DATA(lv_fv_val) = ||. IF lo_lt_dom_r->texts IS NOT INITIAL. lv_fv_val = lo_lt_dom_r->texts[ 1 ]->get_string_value( ). ENDIF.
              IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
              lv_texts_json = lv_texts_json && json_obj( json_join( VALUE #(
                ( json_str( iv_key = 'level' iv_value = 'fixed_value' ) )
                ( json_str( iv_key = 'field_name' iv_value = CONV string( ls_lt_dom_fv-domvalue_l ) ) )
                ( json_str( iv_key = 'attribute' iv_value = 'fixed_value_description' ) )
                ( json_str( iv_key = 'value' iv_value = lv_fv_val ) ) ) ) ).
            ENDLOOP.
          WHEN 'data_definition'.
            DATA(lv_entity_desc) = ||.
            TRY. DATA(lo_ent_desc_tgt) = xco_i18n=>target->data_definition->entity( CONV sxco_cds_object_name( lv_object_name ) ).
                DATA lt_ent_desc_attrs TYPE sxco_t_ddef_ent_text_attributs. APPEND xco_cp_data_definition=>text_attribute->entity->endusertext_label TO lt_ent_desc_attrs.
                DATA(lo_ent_desc_res) = lo_ent_desc_tgt->get_translation( io_language = lo_language it_text_attributes = lt_ent_desc_attrs ).
                IF lo_ent_desc_res->texts IS NOT INITIAL. lv_entity_desc = lo_ent_desc_res->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. ENDTRY.
            IF lv_entity_desc IS NOT INITIAL.
              IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
              lv_texts_json = lv_texts_json && build_text_json_entry( iv_level = 'entity' iv_field_name = '' iv_attribute = 'endusertext_label' iv_value = lv_entity_desc ).
            ENDIF.
            DATA(lt_dd_field_names) = get_cds_field_names( lv_object_name ).
            DATA lt_lt_fld_attrs TYPE string_table. APPEND 'endusertext_label' TO lt_lt_fld_attrs. APPEND 'endusertext_quickinfo' TO lt_lt_fld_attrs.
            LOOP AT lt_dd_field_names INTO DATA(lv_lt_fn).
              DATA lt_lt_fa TYPE sxco_t_ddef_fld_text_attributs. DATA lo_lt_fta TYPE REF TO cl_xco_ddef_fld_text_attribute.
              LOOP AT lt_lt_fld_attrs INTO DATA(lv_lt_fan).
                CLEAR lt_lt_fa. lo_lt_fta = get_ddls_field_attr( lv_lt_fan ). CHECK lo_lt_fta IS BOUND. APPEND lo_lt_fta TO lt_lt_fa.
                DATA(lo_lt_fld) = xco_i18n=>target->data_definition->field( iv_entity_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_lt_fn ) ).
                TRY. DATA(lo_lt_fr) = lo_lt_fld->get_translation( io_language = lo_orig_language it_text_attributes = lt_lt_fa ).
                    DATA(lv_lt_ov) = ||. IF lo_lt_fr->texts IS NOT INITIAL. lv_lt_ov = lo_lt_fr->texts[ 1 ]->get_string_value( ). ENDIF.
                  CATCH cx_root. CLEAR lv_lt_ov. ENDTRY.
                IF lv_lt_ov IS NOT INITIAL.
                  DATA(lv_lt_fv) = ||.
                  IF lv_language <> lv_orig_spras.
                    TRY. DATA(lo_lt_fr2) = lo_lt_fld->get_translation( io_language = lo_language it_text_attributes = lt_lt_fa ).
                        IF lo_lt_fr2->texts IS NOT INITIAL. lv_lt_fv = lo_lt_fr2->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. CLEAR lv_lt_fv. ENDTRY.
                  ELSE. lv_lt_fv = lv_lt_ov. ENDIF.
                  IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
                  lv_texts_json = lv_texts_json && json_obj( json_join( VALUE #(
                    ( json_str( iv_key = 'level' iv_value = 'field' ) )
                    ( json_str( iv_key = 'field_name' iv_value = lv_lt_fn ) )
                    ( json_str( iv_key = 'attribute' iv_value = lv_lt_fan ) )
                    ( json_str( iv_key = 'value' iv_value = lv_lt_fv ) ) ) ) ).
                ENDIF.
              ENDLOOP.
            ENDLOOP.
            " Also scan metadata_extension attributes for same-name DDLX
            DATA lt_lt_dd_me_attrs TYPE string_table. APPEND 'endusertext_label' TO lt_lt_dd_me_attrs. APPEND 'endusertext_quickinfo' TO lt_lt_dd_me_attrs.
            DATA lt_lt_dd_me_pos_attrs TYPE string_table.
            APPEND 'ui_lineitem_label' TO lt_lt_dd_me_pos_attrs. APPEND 'ui_identification_label' TO lt_lt_dd_me_pos_attrs.
            APPEND 'consumption_dynamiclabel_label' TO lt_lt_dd_me_pos_attrs. APPEND 'ui_fieldgroup_label' TO lt_lt_dd_me_pos_attrs.
            APPEND 'ui_fieldgroup_grouplabel' TO lt_lt_dd_me_pos_attrs. APPEND 'ui_facet_label' TO lt_lt_dd_me_pos_attrs.
            APPEND 'consumption_valuehelpdef_label' TO lt_lt_dd_me_pos_attrs.
            DATA(lv_dd_ddlx_src) = ||. SELECT SINGLE source FROM ddlxsrc_src WHERE ddlxname = @lv_object_name AND version = 'A' INTO @lv_dd_ddlx_src.
            LOOP AT lt_dd_field_names INTO DATA(lv_lt_dd_mfn).
              DATA lo_lt_dd_mta TYPE REF TO cl_xco_me_fld_text_attribute.
              LOOP AT lt_lt_dd_me_attrs INTO DATA(lv_lt_dd_man).
                lo_lt_dd_mta = get_me_field_attr( iv_name = lv_lt_dd_man iv_position = 1 ). CHECK lo_lt_dd_mta IS BOUND.
                DATA lt_lt_dd_ma TYPE sxco_t_me_fld_text_attributes. CLEAR lt_lt_dd_ma. APPEND lo_lt_dd_mta TO lt_lt_dd_ma.
                DATA(lo_lt_dd_me_tgt) = xco_i18n=>target->metadata_extension->field( iv_metadata_extension_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_lt_dd_mfn ) ).
                DATA(lv_lt_dd_mv) = ||. DATA(lv_lt_dd_ov) = ||.
                TRY. DATA(lo_lt_dd_mr) = lo_lt_dd_me_tgt->get_translation( io_language = lo_orig_language it_text_attributes = lt_lt_dd_ma ).
                    IF lo_lt_dd_mr->texts IS NOT INITIAL. lv_lt_dd_ov = lo_lt_dd_mr->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. CLEAR lv_lt_dd_ov. ENDTRY.
                IF lv_lt_dd_ov IS NOT INITIAL.
                  IF lv_language <> lv_orig_spras.
                    TRY. DATA(lo_lt_dd_mr2) = lo_lt_dd_me_tgt->get_translation( io_language = lo_language it_text_attributes = lt_lt_dd_ma ).
                        IF lo_lt_dd_mr2->texts IS NOT INITIAL. lv_lt_dd_mv = lo_lt_dd_mr2->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. CLEAR lv_lt_dd_mv. ENDTRY.
                  ELSE. lv_lt_dd_mv = lv_lt_dd_ov. ENDIF.
                  IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
                  lv_texts_json = lv_texts_json && json_obj( json_join( VALUE #(
                    ( json_str( iv_key = 'level' iv_value = 'field' ) ) ( json_str( iv_key = 'field_name' iv_value = lv_lt_dd_mfn ) )
                    ( json_str( iv_key = 'attribute' iv_value = lv_lt_dd_man ) ) ( json_str( iv_key = 'value' iv_value = lv_lt_dd_mv ) ) ) ) ).
                ENDIF.
              ENDLOOP.
              LOOP AT lt_lt_dd_me_pos_attrs INTO DATA(lv_lt_dd_pan).
                DATA(lv_lt_dd_max_pos) = count_ddlx_positions( iv_source = lv_dd_ddlx_src iv_field_name = lv_lt_dd_mfn iv_anno_name = map_me_attr_to_anno( lv_lt_dd_pan ) ).
                DATA(lv_lt_dd_pos) = 1.
                WHILE lv_lt_dd_pos <= lv_lt_dd_max_pos.
                  lo_lt_dd_mta = get_me_field_attr( iv_name = lv_lt_dd_pan iv_position = lv_lt_dd_pos ).
                  IF lo_lt_dd_mta IS NOT BOUND. lv_lt_dd_pos = lv_lt_dd_pos + 1. CONTINUE. ENDIF.
                  CLEAR lt_lt_dd_ma. APPEND lo_lt_dd_mta TO lt_lt_dd_ma.
                  DATA(lo_lt_dd_me_p) = xco_i18n=>target->metadata_extension->field( iv_metadata_extension_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_lt_dd_mfn ) ).
                  DATA(lv_lt_dd_pv) = ||. DATA(lv_lt_dd_pov) = ||.
                  TRY. DATA(lo_lt_dd_pr) = lo_lt_dd_me_p->get_translation( io_language = lo_orig_language it_text_attributes = lt_lt_dd_ma ).
                      IF lo_lt_dd_pr->texts IS NOT INITIAL. lv_lt_dd_pov = lo_lt_dd_pr->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. CLEAR lv_lt_dd_pov. ENDTRY.
                  IF lv_lt_dd_pov IS NOT INITIAL.
                    IF lv_language <> lv_orig_spras.
                      TRY. DATA(lo_lt_dd_pr2) = lo_lt_dd_me_p->get_translation( io_language = lo_language it_text_attributes = lt_lt_dd_ma ).
                          IF lo_lt_dd_pr2->texts IS NOT INITIAL. lv_lt_dd_pv = lo_lt_dd_pr2->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. CLEAR lv_lt_dd_pv. ENDTRY.
                    ELSE. lv_lt_dd_pv = lv_lt_dd_pov. ENDIF.
                    DATA(lv_lt_dd_pan_pos) = |{ lv_lt_dd_pan }[{ lv_lt_dd_pos }]|.
                    IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
                    lv_texts_json = lv_texts_json && json_obj( json_join( VALUE #(
                      ( json_str( iv_key = 'level' iv_value = 'field' ) ) ( json_str( iv_key = 'field_name' iv_value = lv_lt_dd_mfn ) )
                      ( json_str( iv_key = 'attribute' iv_value = lv_lt_dd_pan_pos ) ) ( json_str( iv_key = 'value' iv_value = lv_lt_dd_pv ) ) ) ) ).
                  ENDIF.
                  lv_lt_dd_pos = lv_lt_dd_pos + 1.
                ENDWHILE.
              ENDLOOP.
            ENDLOOP.
          WHEN 'metadata_extension'.
            DATA(lt_me_field_names) = get_cds_field_names( lv_object_name ).
            DATA lt_lt_me_attrs TYPE string_table. APPEND 'endusertext_label' TO lt_lt_me_attrs. APPEND 'endusertext_quickinfo' TO lt_lt_me_attrs.
            DATA lt_lt_me_pos_attrs TYPE string_table.
            APPEND 'ui_lineitem_label' TO lt_lt_me_pos_attrs. APPEND 'ui_identification_label' TO lt_lt_me_pos_attrs.
            APPEND 'consumption_dynamiclabel_label' TO lt_lt_me_pos_attrs. APPEND 'ui_fieldgroup_label' TO lt_lt_me_pos_attrs.
            APPEND 'ui_fieldgroup_grouplabel' TO lt_lt_me_pos_attrs. APPEND 'ui_facet_label' TO lt_lt_me_pos_attrs.
            APPEND 'consumption_valuehelpdef_label' TO lt_lt_me_pos_attrs.
            DATA(lv_me_ddlx_src) = ||. SELECT SINGLE source FROM ddlxsrc_src WHERE ddlxname = @lv_object_name AND version = 'A' INTO @lv_me_ddlx_src.
            LOOP AT lt_me_field_names INTO DATA(lv_lt_mfn).
              DATA lo_lt_mta TYPE REF TO cl_xco_me_fld_text_attribute.
              LOOP AT lt_lt_me_attrs INTO DATA(lv_lt_man).
                lo_lt_mta = get_me_field_attr( iv_name = lv_lt_man iv_position = 1 ). CHECK lo_lt_mta IS BOUND.
                DATA lt_lt_ma TYPE sxco_t_me_fld_text_attributes. CLEAR lt_lt_ma. APPEND lo_lt_mta TO lt_lt_ma.
                DATA(lo_lt_me_tgt) = xco_i18n=>target->metadata_extension->field( iv_metadata_extension_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_lt_mfn ) ).
                TRY. DATA(lo_lt_mr) = lo_lt_me_tgt->get_translation( io_language = lo_orig_language it_text_attributes = lt_lt_ma ).
                    DATA(lv_lt_mov) = ||. IF lo_lt_mr->texts IS NOT INITIAL. lv_lt_mov = lo_lt_mr->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. CLEAR lv_lt_mov. ENDTRY.
                IF lv_lt_mov IS NOT INITIAL.
                  DATA(lv_lt_mv) = ||.
                  IF lv_language <> lv_orig_spras.
                    TRY. DATA(lo_lt_mr2) = lo_lt_me_tgt->get_translation( io_language = lo_language it_text_attributes = lt_lt_ma ).
                        IF lo_lt_mr2->texts IS NOT INITIAL. lv_lt_mv = lo_lt_mr2->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. CLEAR lv_lt_mv. ENDTRY.
                  ELSE. lv_lt_mv = lv_lt_mov. ENDIF.
                  IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
                  lv_texts_json = lv_texts_json && json_obj( json_join( VALUE #(
                    ( json_str( iv_key = 'level' iv_value = 'field' ) ) ( json_str( iv_key = 'field_name' iv_value = lv_lt_mfn ) )
                    ( json_str( iv_key = 'attribute' iv_value = lv_lt_man ) ) ( json_str( iv_key = 'value' iv_value = lv_lt_mv ) ) ) ) ).
                ENDIF.
              ENDLOOP.
              LOOP AT lt_lt_me_pos_attrs INTO DATA(lv_lt_pan).
                DATA(lv_lt_max_pos) = count_ddlx_positions( iv_source = lv_me_ddlx_src iv_field_name = lv_lt_mfn iv_anno_name = map_me_attr_to_anno( lv_lt_pan ) ).
                DATA(lv_lt_pos) = 1.
                WHILE lv_lt_pos <= lv_lt_max_pos.
                  lo_lt_mta = get_me_field_attr( iv_name = lv_lt_pan iv_position = lv_lt_pos ).
                  IF lo_lt_mta IS NOT BOUND. lv_lt_pos = lv_lt_pos + 1. CONTINUE. ENDIF.
                  CLEAR lt_lt_ma. APPEND lo_lt_mta TO lt_lt_ma.
                  DATA(lo_lt_me_p) = xco_i18n=>target->metadata_extension->field( iv_metadata_extension_name = CONV sxco_cds_object_name( lv_object_name ) iv_field_name = CONV sxco_cds_field_name( lv_lt_mfn ) ).
                  DATA(lv_lt_pv) = ||. DATA(lv_lt_pov) = ||.
                  TRY. DATA(lo_lt_pr) = lo_lt_me_p->get_translation( io_language = lo_orig_language it_text_attributes = lt_lt_ma ).
                      IF lo_lt_pr->texts IS NOT INITIAL. lv_lt_pov = lo_lt_pr->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. CLEAR lv_lt_pov. ENDTRY.
                  IF lv_lt_pov IS NOT INITIAL.
                    IF lv_language <> lv_orig_spras.
                      TRY. DATA(lo_lt_pr2) = lo_lt_me_p->get_translation( io_language = lo_language it_text_attributes = lt_lt_ma ).
                          IF lo_lt_pr2->texts IS NOT INITIAL. lv_lt_pv = lo_lt_pr2->texts[ 1 ]->get_string_value( ). ENDIF. CATCH cx_root. CLEAR lv_lt_pv. ENDTRY.
                    ELSE. lv_lt_pv = lv_lt_pov. ENDIF.
                    DATA(lv_lt_pan_pos) = |{ lv_lt_pan }[{ lv_lt_pos }]|.
                    IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
                    lv_texts_json = lv_texts_json && json_obj( json_join( VALUE #(
                      ( json_str( iv_key = 'level' iv_value = 'field' ) ) ( json_str( iv_key = 'field_name' iv_value = lv_lt_mfn ) )
                      ( json_str( iv_key = 'attribute' iv_value = lv_lt_pan_pos ) ) ( json_str( iv_key = 'value' iv_value = lv_lt_pv ) ) ) ) ).
                  ENDIF.
                  lv_lt_pos = lv_lt_pos + 1.
                ENDWHILE.
              ENDLOOP.
            ENDLOOP.
          WHEN 'message_class'.
            SELECT DISTINCT msgnr FROM t100 WHERE arbgb = @lv_object_name ORDER BY msgnr INTO TABLE @DATA(lt_lt_mc_nums).
            LOOP AT lt_lt_mc_nums INTO DATA(ls_lt_mc_num).
              DATA(lo_lt_mc_tgt) = xco_i18n=>target->message_class->message( iv_message_class_name = CONV sxco_mc_object_name( lv_object_name ) iv_message_number = CONV if_xco_mc_message=>tv_number( ls_lt_mc_num-msgnr ) ).
              DATA lt_lt_mc_a TYPE sxco_t_mc_text_attributes. CLEAR lt_lt_mc_a. APPEND xco_cp_message_class=>text_attribute->message_short_text TO lt_lt_mc_a.
              DATA(lo_lt_mc_r) = lo_lt_mc_tgt->get_translation( io_language = lo_language it_text_attributes = lt_lt_mc_a ).
              DATA(lv_lt_mc_v) = ||. IF lo_lt_mc_r->texts IS NOT INITIAL. lv_lt_mc_v = lo_lt_mc_r->texts[ 1 ]->get_string_value( ). ENDIF.
              IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
              lv_texts_json = lv_texts_json && json_obj( json_join( VALUE #(
                ( json_str( iv_key = 'level' iv_value = 'message' ) ) ( json_str( iv_key = 'field_name' iv_value = CONV string( ls_lt_mc_num-msgnr ) ) )
                ( json_str( iv_key = 'attribute' iv_value = 'message_short_text' ) ) ( json_str( iv_key = 'value' iv_value = lv_lt_mc_v ) ) ) ) ).
            ENDLOOP.
          WHEN 'text_pool'.
            IF lv_pool_type = 'function_group'.
              DATA lv_lt_fg_prog TYPE syrepid. lv_lt_fg_prog = |SAPL{ lv_object_name }|.
              DATA lt_lt_fg_tp TYPE TABLE OF textpool. DATA(lv_lt_fg_lang) = CONV spras( lv_language ).
              READ TEXTPOOL lv_lt_fg_prog INTO lt_lt_fg_tp LANGUAGE lv_lt_fg_lang.
              LOOP AT lt_lt_fg_tp INTO DATA(ls_lt_fg_tp) WHERE id = 'I'.
                DATA(lv_lt_fg_key) = ls_lt_fg_tp-key.
                DATA(lo_lt_fg_tgt) = xco_i18n=>target->text_pool->function_group_text_symbol( iv_function_group_name = CONV sxco_fg_object_name( lv_object_name ) iv_text_symbol_id = CONV if_xco_i18n_tp_target_factory=>tv_text_symbol_id( lv_lt_fg_key ) ).
                DATA lt_lt_tp_a TYPE sxco_t_tp_text_attributes. CLEAR lt_lt_tp_a. APPEND xco_cp_text_pool=>text_attribute->text_element_text TO lt_lt_tp_a.
                DATA(lo_lt_fg_r) = lo_lt_fg_tgt->get_translation( io_language = lo_language it_text_attributes = lt_lt_tp_a ).
                DATA(lv_lt_fg_v) = ||. IF lo_lt_fg_r->texts IS NOT INITIAL. lv_lt_fg_v = lo_lt_fg_r->texts[ 1 ]->get_string_value( ). ENDIF.
                IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
                lv_texts_json = lv_texts_json && json_obj( json_join( VALUE #(
                  ( json_str( iv_key = 'level' iv_value = 'text_symbol' ) ) ( json_str( iv_key = 'field_name' iv_value = CONV string( lv_lt_fg_key ) ) )
                  ( json_str( iv_key = 'attribute' iv_value = 'text_element_text' ) ) ( json_str( iv_key = 'value' iv_value = lv_lt_fg_v ) ) ) ) ).
              ENDLOOP.
            ELSE.
              DATA lv_lt_cls_prog TYPE syrepid. lv_lt_cls_prog = |{ lv_object_name }======================CP|.
              DATA lt_lt_cls_tp TYPE TABLE OF textpool. DATA(lv_lt_cls_lang) = CONV spras( lv_language ).
              READ TEXTPOOL lv_lt_cls_prog INTO lt_lt_cls_tp LANGUAGE lv_lt_cls_lang.
              LOOP AT lt_lt_cls_tp INTO DATA(ls_lt_cls_tp) WHERE id = 'I'.
                DATA(lv_lt_cls_key) = ls_lt_cls_tp-key.
                DATA(lo_lt_cls_tgt) = xco_i18n=>target->text_pool->class_text_symbol( iv_class_name = CONV sxco_ao_object_name( lv_object_name ) iv_text_symbol_id = CONV if_xco_i18n_tp_target_factory=>tv_text_symbol_id( lv_lt_cls_key ) ).
                CLEAR lt_lt_tp_a. APPEND xco_cp_text_pool=>text_attribute->text_element_text TO lt_lt_tp_a.
                DATA(lo_lt_cls_r) = lo_lt_cls_tgt->get_translation( io_language = lo_language it_text_attributes = lt_lt_tp_a ).
                DATA(lv_lt_cls_v) = ||. IF lo_lt_cls_r->texts IS NOT INITIAL. lv_lt_cls_v = lo_lt_cls_r->texts[ 1 ]->get_string_value( ). ENDIF.
                IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
                lv_texts_json = lv_texts_json && json_obj( json_join( VALUE #(
                  ( json_str( iv_key = 'level' iv_value = 'text_symbol' ) ) ( json_str( iv_key = 'field_name' iv_value = CONV string( lv_lt_cls_key ) ) )
                  ( json_str( iv_key = 'attribute' iv_value = 'text_element_text' ) ) ( json_str( iv_key = 'value' iv_value = lv_lt_cls_v ) ) ) ) ).
              ENDLOOP.
            ENDIF.
          WHEN 'application_log_object'.
            DATA(lo_lt_aplo) = xco_i18n=>target->application_log_object->object( iv_name = CONV sxco_aplo_object_name( lv_object_name ) ).
            DATA lt_lt_aplo_attrs TYPE sxco_t_aplo_obj_text_attribts. APPEND xco_cp_application_log_object=>text_attribute->object->short_description TO lt_lt_aplo_attrs.
            DATA(lo_lt_aplo_res) = lo_lt_aplo->get_translation( io_language = lo_language it_text_attributes = lt_lt_aplo_attrs ).
            DATA(lv_lt_aplo_val) = ||. IF lo_lt_aplo_res->texts IS NOT INITIAL. lv_lt_aplo_val = lo_lt_aplo_res->texts[ 1 ]->get_string_value( ). ENDIF.
            IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
            lv_texts_json = lv_texts_json && build_text_json_entry( iv_level = 'entity' iv_field_name = '' iv_attribute = 'short_description' iv_value = lv_lt_aplo_val ).
          WHEN 'business_configuration_object'.
            DATA(lo_lt_bco) = xco_i18n=>target->business_configuration_object->object( iv_name = CONV sxco_bco_name( lv_object_name ) ).
            DATA lt_lt_bco_attrs TYPE sxco_t_bco_text_attributes. APPEND xco_cp_business_cnfgrtn_object=>text_attribute->description TO lt_lt_bco_attrs.
            DATA(lo_lt_bco_res) = lo_lt_bco->get_translation( io_language = lo_language it_text_attributes = lt_lt_bco_attrs ).
            DATA(lv_lt_bco_val) = ||. IF lo_lt_bco_res->texts IS NOT INITIAL. lv_lt_bco_val = lo_lt_bco_res->texts[ 1 ]->get_string_value( ). ENDIF.
            IF lv_texts_json IS NOT INITIAL. lv_texts_json = lv_texts_json && |,|. ENDIF.
            lv_texts_json = lv_texts_json && build_text_json_entry( iv_level = 'entity' iv_field_name = '' iv_attribute = 'description' iv_value = lv_lt_bco_val ).
          WHEN OTHERS.
            rs_response = build_error( iv_code = 'UNSUPPORTED_TARGET' iv_message = |list_texts: target_type '{ lv_target_type }' is not supported| ). RETURN.
        ENDCASE.
        " When the caller omitted the language, report the resolved original language
        " as an ISO code (like list_languages), not the internal SAP single-char code.
        DATA(lv_out_language) = COND string( WHEN lv_lang_omitted = abap_true
                                             THEN iso_from_sap( CONV spras( lv_language ) )
                                             ELSE lv_language ).
        DATA(lv_data) = json_obj( json_join( VALUE #(
          ( json_str( iv_key = 'target_type' iv_value = lv_target_type ) )
          ( json_str( iv_key = 'object_name' iv_value = lv_object_name ) )
          ( json_str( iv_key = 'language' iv_value = lv_out_language ) )
          ( |"texts":[{ lv_texts_json }]| )
        ) ) ).
        rs_response = build_success( iv_data = lv_data ).
      CATCH cx_root INTO DATA(lx_error).
        rs_response = build_error( iv_code = 'LIST_TEXTS_ERROR' iv_message = lx_error->get_text( ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD parse_string_array.
    DATA lv_val TYPE string.
    DATA(lv_content) = iv_content.
    WHILE lv_content IS NOT INITIAL.
      FIND PCRE '"([^"]*)"' IN lv_content SUBMATCHES lv_val MATCH LENGTH DATA(lv_len) MATCH OFFSET DATA(lv_off).
      IF sy-subrc <> 0. EXIT. ENDIF.
      APPEND lv_val TO rt_values.
      DATA(lv_next) = lv_off + lv_len.
      IF lv_next >= strlen( lv_content ). EXIT. ENDIF.
      lv_content = lv_content+lv_next.
    ENDWHILE.
  ENDMETHOD.

  METHOD append_text_entry.
    DATA(lv_entry) = json_obj( json_join( VALUE #(
      ( json_str( iv_key = 'attribute' iv_value = iv_attribute ) )
      ( json_str( iv_key = 'value'     iv_value = iv_value     ) )
    ) ) ).
    IF iv_json IS NOT INITIAL.
      rv_json = iv_json && ',' && lv_entry.
    ELSE.
      rv_json = lv_entry.
    ENDIF.
  ENDMETHOD.

  METHOD get_de_text_attr.
    CASE iv_name.
      WHEN 'short_field_label'.    ro_attr = xco_cp_data_element=>text_attribute->short_field_label.
      WHEN 'medium_field_label'.   ro_attr = xco_cp_data_element=>text_attribute->medium_field_label.
      WHEN 'long_field_label'.     ro_attr = xco_cp_data_element=>text_attribute->long_field_label.
      WHEN 'heading_field_label'.  ro_attr = xco_cp_data_element=>text_attribute->heading_field_label.
    ENDCASE.
  ENDMETHOD.

  METHOD get_dd_entity_attr.
    CASE iv_name.
      WHEN 'endusertext_label'.                ro_attr = xco_cp_data_definition=>text_attribute->entity->endusertext_label.
      WHEN 'ui_headerinfo_description_label'.  ro_attr = xco_cp_data_definition=>text_attribute->entity->ui_headerinfo_description_labe.
      WHEN 'ui_headerinfo_title_label'.        ro_attr = xco_cp_data_definition=>text_attribute->entity->ui_headerinfo_title_label.
      WHEN 'ui_headerinfo_typename'.           ro_attr = xco_cp_data_definition=>text_attribute->entity->ui_headerinfo_typename.
      WHEN 'ui_headerinfo_typenameplural'.     ro_attr = xco_cp_data_definition=>text_attribute->entity->ui_headerinfo_typenameplural.
    ENDCASE.
  ENDMETHOD.

  METHOD get_ddls_field_attr.
    CASE iv_name.
      WHEN 'endusertext_label'.     ro_attr = xco_cp_data_definition=>text_attribute->field->endusertext_label.
      WHEN 'endusertext_quickinfo'. ro_attr = xco_cp_data_definition=>text_attribute->field->endusertext_quickinfo.
    ENDCASE.
  ENDMETHOD.

  METHOD get_me_field_attr.
    CASE iv_name.
      WHEN 'endusertext_label'.              ro_attr = xco_cp_metadata_extension=>text_attribute->field->endusertext_label.
      WHEN 'endusertext_quickinfo'.          ro_attr = xco_cp_metadata_extension=>text_attribute->field->endusertext_quickinfo.
      WHEN 'ui_lineitem_label'.              ro_attr = xco_cp_metadata_extension=>text_attribute->field->ui_lineitem_label( iv_position ).
      WHEN 'ui_identification_label'.        ro_attr = xco_cp_metadata_extension=>text_attribute->field->ui_identification_label( iv_position ).
      WHEN 'consumption_dynamiclabel_label'. ro_attr = xco_cp_metadata_extension=>text_attribute->field->consumption_dynamiclabel_label.
      WHEN 'ui_fieldgroup_label'.            ro_attr = xco_cp_metadata_extension=>text_attribute->field->ui_fieldgroup_label( iv_position ).
      WHEN 'ui_fieldgroup_grouplabel'.       ro_attr = xco_cp_metadata_extension=>text_attribute->field->ui_fieldgroup_grouplabel( iv_position ).
      WHEN 'ui_facet_label'.                 ro_attr = xco_cp_metadata_extension=>text_attribute->field->ui_facet_label( iv_position ).
      WHEN 'consumption_valuehelpdef_label'. ro_attr = xco_cp_metadata_extension=>text_attribute->field->consumption_valuehelpdef_label( iv_position ).
    ENDCASE.
  ENDMETHOD.

  METHOD get_cds_field_names.
    DATA(lo_cds) = xco_cp_cds=>data_definition( CONV sxco_cds_object_name( iv_object_name ) ).
    TRY.
        DATA(lv_type) = lo_cds->get_type( )->value.
        DATA lt_fields TYPE TABLE OF REF TO if_xco_cds_field.
        CASE lv_type.
          WHEN 'V'. lt_fields = lo_cds->view( )->fields->all->get( ).
          WHEN 'E'. lt_fields = lo_cds->view_entity( )->fields->all->get( ).
          WHEN 'P'. lt_fields = lo_cds->projection_view( )->fields->all->get( ).
          WHEN 'A'. lt_fields = lo_cds->abstract_entity( )->fields->all->get( ).
          WHEN 'C'. lt_fields = lo_cds->custom_entity( )->fields->all->get( ).
        ENDCASE.
        LOOP AT lt_fields INTO DATA(lo_field).
          APPEND lo_field->name TO rt_names.
        ENDLOOP.
      CATCH cx_root.
    ENDTRY.
    IF rt_names IS INITIAL.
      TRY.
          DATA lo_struct TYPE REF TO cl_abap_structdescr.
          lo_struct ?= cl_abap_typedescr=>describe_by_name( iv_object_name ).
          LOOP AT lo_struct->get_components( ) INTO DATA(ls_comp).
            APPEND ls_comp-name TO rt_names.
          ENDLOOP.
        CATCH cx_root.
      ENDTRY.
    ENDIF.
  ENDMETHOD.

  METHOD resolve_original_language.
    " Map the translation target type to its ABAP Repository (TADIR / R3TR) object type.
    DATA lv_obj_type TYPE sxco_ar_object_type.
    CASE iv_target_type.
      WHEN 'data_element'.       lv_obj_type = 'DTEL'.
      WHEN 'domain'.             lv_obj_type = 'DOMA'.
      WHEN 'data_definition'.    lv_obj_type = 'DDLS'.
      WHEN 'metadata_extension'. lv_obj_type = 'DDLX'.
      WHEN 'message_class'.      lv_obj_type = 'MSAG'.
      WHEN 'text_pool'.
        IF iv_pool_type = 'function_group'.
          lv_obj_type = 'FUGR'.
        ELSE.
          lv_obj_type = 'CLAS'.
        ENDIF.
      WHEN 'application_log_object'.        lv_obj_type = 'APLO'.
      WHEN 'business_configuration_object'. lv_obj_type = 'SMBC'.
    ENDCASE.
    IF lv_obj_type IS INITIAL. rv_spras = sy-langu. RETURN. ENDIF.

    " Primary source: XCO's repository-object original language — the same value ADT/Eclipse
    " reports, and more reliable than TADIR-MASTERLANG. The generic object factory returns an
    " IF_XCO_AR_OBJECT for ANY repository object type (DTEL, DOMA, DDLS, DDLX, MSAG, CLAS, FUGR,
    " APLO, SMBC), so a single call covers every translation target.
    TRY.
        DATA(lv_xco_spras) = xco_cp_abap_repository=>object->for(
                               iv_type = lv_obj_type
                               iv_name = CONV sxco_ar_object_name( iv_object_name )
                             )->get_original_language( )->value.
        IF lv_xco_spras IS NOT INITIAL.
          rv_spras = lv_xco_spras.
          RETURN.
        ENDIF.
      CATCH cx_root.
        " XCO could not resolve it (object missing / type unsupported) -> fall back to TADIR.
    ENDTRY.

    " Fallback: TADIR master language.
    SELECT SINGLE masterlang FROM tadir
      WHERE pgmid = 'R3TR' AND object = @lv_obj_type AND obj_name = @iv_object_name
      INTO @rv_spras.
    IF sy-subrc <> 0. rv_spras = sy-langu. ENDIF.
  ENDMETHOD.

  METHOD iso_from_sap.
    " Map a SAP single-char language code to its 2-letter ISO 639-1 code so an
    " omitted (original) language is reported in the same form as list_languages.
    SELECT SINGLE LanguageISOCode FROM I_Language
      WHERE Language = @iv_spras INTO @DATA(lv_iso).
    IF sy-subrc = 0 AND lv_iso IS NOT INITIAL.
      rv_iso = lv_iso.
    ELSE.
      rv_iso = iv_spras.   " no ISO mapping -> fall back to the SAP code
    ENDIF.
  ENDMETHOD.

  METHOD build_text_json_entry.
    rv_json = json_obj( json_join( VALUE #(
      ( json_str( iv_key = 'level'      iv_value = iv_level ) )
      ( json_str( iv_key = 'field_name' iv_value = iv_field_name ) )
      ( json_str( iv_key = 'attribute'  iv_value = iv_attribute ) )
      ( json_str( iv_key = 'value'      iv_value = iv_value ) )
      ( json_bool( iv_key = 'populated' iv_value = xsdbool( iv_value IS NOT INITIAL ) ) )
    ) ) ).
  ENDMETHOD.

  METHOD map_me_attr_to_anno.
    CASE iv_attr_name.
      WHEN 'ui_lineitem_label'.              rv_anno = 'UI.LINEITEM'.
      WHEN 'ui_identification_label'.        rv_anno = 'UI.IDENTIFICATION'.
      WHEN 'consumption_dynamiclabel_label'. rv_anno = 'CONSUMPTION.DYNAMICLABEL'.
      WHEN 'ui_fieldgroup_label'.            rv_anno = 'UI.FIELDGROUP'.
      WHEN 'ui_fieldgroup_grouplabel'.       rv_anno = 'UI.FIELDGROUP'.
      WHEN 'ui_facet_label'.                 rv_anno = 'UI.FACET'.
      WHEN 'consumption_valuehelpdef_label'. rv_anno = 'CONSUMPTION.VALUEHELPDEFINITION'.
    ENDCASE.
  ENDMETHOD.

  METHOD count_ddlx_positions.
    IF iv_source IS INITIAL OR iv_anno_name IS INITIAL.
      rv_count = 0. RETURN.
    ENDIF.
    DATA(lv_field_pat) = iv_field_name && ';'.
    FIND lv_field_pat IN iv_source MATCH OFFSET DATA(lv_fld_off) IGNORING CASE.
    IF sy-subrc <> 0. rv_count = 0. RETURN. ENDIF.
    DATA(lv_block) = iv_source(lv_fld_off).
    DATA(lv_prev_end) = 0.
    DATA(lv_search_from) = 0.
    DO.
      FIND ';' IN SECTION OFFSET lv_search_from OF lv_block MATCH OFFSET DATA(lv_sc_off).
      IF sy-subrc <> 0. EXIT. ENDIF.
      lv_prev_end = lv_sc_off + 1.
      lv_search_from = lv_sc_off + 1.
    ENDDO.
    DATA(lv_field_block) = lv_block+lv_prev_end.
    DATA(lv_anno_pat) = '@' && iv_anno_name && ':'.
    FIND lv_anno_pat IN lv_field_block MATCH OFFSET DATA(lv_anno_off) IGNORING CASE.
    IF sy-subrc <> 0. rv_count = 0. RETURN. ENDIF.
    DATA(lv_after) = lv_field_block+lv_anno_off.
    FIND '[' IN lv_after MATCH OFFSET DATA(lv_arr_off).
    IF sy-subrc <> 0. rv_count = 1. RETURN. ENDIF.
    DATA(lv_depth) = 0.
    DATA(lv_idx) = lv_arr_off + 1.
    DATA(lv_len) = strlen( lv_after ).
    WHILE lv_idx < lv_len.
      DATA(lv_ch) = lv_after+lv_idx(1).
      CASE lv_ch.
        WHEN ']'.
          IF lv_depth = 0. EXIT. ENDIF.
          lv_depth = lv_depth - 1.
        WHEN '['. lv_depth = lv_depth + 1.
        WHEN '{'.
          IF lv_depth = 0. rv_count = rv_count + 1. ENDIF.
      ENDCASE.
      lv_idx = lv_idx + 1.
    ENDWHILE.
  ENDMETHOD.

  " ── JSON / param helpers (inlined, formerly zcl_vsp_utils) ────────────

  METHOD escape_json.
    rv_escaped = iv_string.
    REPLACE ALL OCCURRENCES OF '\' IN rv_escaped WITH '\\'.
    REPLACE ALL OCCURRENCES OF '"' IN rv_escaped WITH '\"'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>cr_lf IN rv_escaped WITH '\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN rv_escaped WITH '\n'.
    REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>horizontal_tab IN rv_escaped WITH '\t'.
  ENDMETHOD.

  METHOD extract_param.
    DATA lv_name TYPE string.
    lv_name = iv_name.
    CONDENSE lv_name.
    DATA(lv_search) = |"{ lv_name }":|.
    DATA lv_pos TYPE i.
    FIND lv_search IN iv_params MATCH OFFSET lv_pos.
    IF sy-subrc = 0.
      DATA(lv_rest) = iv_params+lv_pos.
      FIND PCRE ':\s*"([^"]*)"' IN lv_rest SUBMATCHES rv_value.
    ENDIF.
  ENDMETHOD.

  METHOD json_obj.
    DATA(lv_open) = '{'.
    DATA(lv_close) = '}'.
    rv_json = |{ lv_open }{ iv_content }{ lv_close }|.
  ENDMETHOD.

  METHOD json_str.
    rv_json = |"{ iv_key }":"{ escape_json( iv_value ) }"|.
  ENDMETHOD.

  METHOD json_bool.
    DATA(lv_val) = COND string( WHEN iv_value = abap_true THEN 'true' ELSE 'false' ).
    rv_json = |"{ iv_key }":{ lv_val }|.
  ENDMETHOD.

  METHOD json_join.
    DATA lv_first TYPE abap_bool VALUE abap_true.
    LOOP AT it_parts INTO DATA(lv_part).
      IF lv_part IS INITIAL.
        CONTINUE.
      ENDIF.
      IF lv_first = abap_false.
        rv_json = |{ rv_json },|.
      ENDIF.
      rv_json = |{ rv_json }{ lv_part }|.
      lv_first = abap_false.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.